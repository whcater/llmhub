package main

import (
    "encoding/binary"
    "fmt"
    "io"
    "log"
    "net"
    "net/url"
    "time"
)

type Relay struct {
    port     int
    proxy    *url.URL
    nat      *NATTable
    listener net.Listener
}

func NewRelay(port int, proxy *url.URL, nat *NATTable) *Relay {
    return &Relay{port: port, proxy: proxy, nat: nat}
}

func (r *Relay) Start() error {
    ln, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", r.port))
    if err != nil {
        return err
    }
    r.listener = ln
    go r.accept()
    return nil
}

func (r *Relay) Stop() { r.listener.Close() }

func (r *Relay) accept() {
    for {
        conn, err := r.listener.Accept()
        if err != nil {
            return
        }
        log.Printf("relay: accepted connection from %s", conn.RemoteAddr())
        go r.handle(conn)
    }
}

func (r *Relay) handle(conn net.Conn) {
    defer conn.Close()

    // 拿到 workerd 这端的源端口
    srcPort := uint16(conn.RemoteAddr().(*net.TCPAddr).Port)

    // 查找原始目标
    entry, ok := r.nat.Get(srcPort)
    if !ok {
        log.Printf("relay: no NAT entry for port %d - dropping connection", srcPort)
        return
    }

    log.Printf("relay: connecting %d → %s:%d via %s", srcPort, entry.OrigDstIP, entry.OrigDstPort, r.proxy.Scheme)

    // 连接到代理
    proxyConn, err := r.connectViaProxy(entry.OrigDstIP.String(), entry.OrigDstPort)
    if err != nil {
        log.Printf("relay: proxy connect failed for %s:%d: %v", entry.OrigDstIP, entry.OrigDstPort, err)
        return
    }
    defer proxyConn.Close()

    // 双向转发
    done := make(chan struct{}, 2)
    go func() { io.Copy(proxyConn, conn); done <- struct{}{} }()
    go func() { io.Copy(conn, proxyConn); done <- struct{}{} }()
    <-done
}

func (r *Relay) connectViaProxy(dstHost string, dstPort uint16) (net.Conn, error) {
    switch r.proxy.Scheme {
    case "socks5":
        return r.socks5Connect(dstHost, dstPort)
    case "http", "https":
        return r.httpConnect(dstHost, dstPort)
    default:
        return nil, fmt.Errorf("unsupported proxy scheme: %s", r.proxy.Scheme)
    }
}

// SOCKS5 实现
func (r *Relay) socks5Connect(dstHost string, dstPort uint16) (net.Conn, error) {
    conn, err := net.DialTimeout("tcp", r.proxy.Host, 10*time.Second)
    if err != nil {
        return nil, err
    }

    // Greeting
    conn.Write([]byte{0x05, 0x01, 0x00}) // VER=5, NMETHODS=1, NO_AUTH
    resp := make([]byte, 2)
    if _, err := io.ReadFull(conn, resp); err != nil {
        conn.Close(); return nil, err
    }
    if resp[0] != 0x05 || resp[1] != 0x00 {
        conn.Close(); return nil, fmt.Errorf("socks5 auth failed")
    }

    // Connect request (ATYP=0x01 IPv4 或 0x03 域名)
    ip := net.ParseIP(dstHost).To4()
    var req []byte
    if ip != nil {
        req = []byte{0x05, 0x01, 0x00, 0x01,
            ip[0], ip[1], ip[2], ip[3],
            byte(dstPort >> 8), byte(dstPort)}
    } else {
        req = make([]byte, 7+len(dstHost))
        req[0], req[1], req[2], req[3] = 0x05, 0x01, 0x00, 0x03
        req[4] = byte(len(dstHost))
        copy(req[5:], dstHost)
        binary.BigEndian.PutUint16(req[5+len(dstHost):], dstPort)
    }
    conn.Write(req)

    // Response (至少 10 bytes)
    header := make([]byte, 10)
    if _, err := io.ReadFull(conn, header); err != nil {
        conn.Close(); return nil, err
    }
    if header[1] != 0x00 {
        conn.Close(); return nil, fmt.Errorf("socks5 connect failed: %d", header[1])
    }

    // 跳过剩余 BND.ADDR
    if header[3] == 0x03 {
        extra := make([]byte, int(header[4])-4) // 已读了4字节addr
        io.ReadFull(conn, extra)
    } else if header[3] == 0x04 {
        extra := make([]byte, 12) // IPv6 多出的部分
        io.ReadFull(conn, extra)
    }

    return conn, nil
}

// HTTP CONNECT 实现
func (r *Relay) httpConnect(dstHost string, dstPort uint16) (net.Conn, error) {
    conn, err := net.DialTimeout("tcp", r.proxy.Host, 10*time.Second)
    if err != nil {
        return nil, err
    }

    target := fmt.Sprintf("%s:%d", dstHost, dstPort)
    req := fmt.Sprintf("CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n", target, target)
    conn.Write([]byte(req))

    // 读响应头直到 \r\n\r\n
    buf := make([]byte, 1)
    var resp []byte
    for {
        conn.Read(buf)
        resp = append(resp, buf[0])
        if len(resp) >= 4 && string(resp[len(resp)-4:]) == "\r\n\r\n" {
            break
        }
    }
    if len(resp) < 12 || string(resp[9:12]) != "200" {
        conn.Close()
        return nil, fmt.Errorf("HTTP CONNECT failed: %s", resp[:min(len(resp),50)])
    }
    return conn, nil
}

func min(a, b int) int {
    if a < b { return a }
    return b
}