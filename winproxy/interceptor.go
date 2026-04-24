package main

import (
    "fmt"
    "log"
    "net"
    "time"
)

type Interceptor struct {
    processName string
    relayPort   uint16
    nat         *NATTable
    noproxy     *NoProxyList
    localIP     net.IP
    handle      Handle
    quit        chan struct{}
}

var localhost = net.IP{127, 0, 0, 1}

func NewInterceptor(processName string, relayPort uint16, nat *NATTable, noproxy *NoProxyList) *Interceptor {
    return &Interceptor{
        processName: processName,
        relayPort:   relayPort,
        nat:         nat,
        noproxy:     noproxy,
        localIP:     getLocalIP(),
        quit:        make(chan struct{}),
    }
}

func getLocalIP() net.IP {
    conn, err := net.Dial("udp", "8.8.8.8:80")
    if err != nil {
        return net.ParseIP("127.0.0.1")
    }
    defer conn.Close()
    return conn.LocalAddr().(*net.UDPAddr).IP
}

func (i *Interceptor) Start() error {
    filter := fmt.Sprintf(
        "(tcp and outbound and !loopback and tcp.DstPort != %d) or "+
            "(tcp and inbound and loopback and tcp.SrcPort == %d)",
        i.relayPort, i.relayPort)

    log.Printf("WinDivert filter: %s", filter)

    h, err := WinDivertOpen(filter, WINDIVERT_LAYER_NETWORK, 0, WINDIVERT_FLAG_DEFAULT)
    if err != nil {
        return err
    }
    i.handle = h
    go i.loop()
    return nil
}

func (i *Interceptor) Stop() {
    close(i.quit)
    i.handle.Close()
}

func (i *Interceptor) loop() {
    buf := make([]byte, 65536)
    for {
        select {
        case <-i.quit:
            return
        default:
        }

        n, addr, err := i.handle.Recv(buf)
        if err != nil {
            select {
            case <-i.quit:
                return
            default:
                log.Printf("WinDivert recv error: %v", err)
                time.Sleep(10 * time.Millisecond)
                continue
            }
        }

        pkt := make([]byte, n)
        copy(pkt, buf[:n])
        go i.handlePacket(pkt, addr)
    }
}

func (i *Interceptor) handlePacket(buf []byte, addr *WinDivertAddress) {
    ip, tcp, ok := parseIPv4TCP(buf)
    if !ok {
        i.handle.Send(buf, addr)
        return
    }

    if addr.IsOutbound() {
        srcPort := ntohs(tcp.SrcPort)

        if isSYN(tcp) {
            if !i.isTargetProcess(srcPort) {
                i.handle.Send(buf, addr)
                return
            }
            // ★ 只有目标进程才打印
            log.Printf("DEBUG SYN flags=%032b outbound=%v loopback=%v",
                addr.Flags, addr.IsOutbound(), addr.IsLoopback())

            origDst := ip4ToNet(ip.DstIP)
            origSrc := ip4ToNet(ip.SrcIP)
            dstPort := ntohs(tcp.DstPort)

            if i.noproxy.Contains(origDst) {
                i.handle.Send(buf, addr)
                return
            }

            log.Printf("intercepted: :%d → %s:%d", srcPort, origDst, dstPort)
            i.nat.Add(srcPort, origSrc, origDst, dstPort)
        } else {
            if _, ok := i.nat.Get(srcPort); !ok {
                i.handle.Send(buf, addr)
                return
            }
            log.Printf("DEBUG non-SYN outbound port=%d flags=%032b", srcPort, addr.Flags)
        }

        copy(ip.SrcIP[:], []byte{127, 0, 0, 1})
        copy(ip.DstIP[:], []byte{127, 0, 0, 1})
        tcp.DstPort = htons(i.relayPort)
        addr.Flags |= 1 << 18

        CalcChecksums(buf, addr)
        err := i.handle.Send(buf, addr)
        log.Printf("DEBUG rewrite → 127.0.0.1:%d send_err=%v", i.relayPort, err)

    } else {
        i.handleInboundFromRelay(buf, addr, ip, tcp)
    }
}

func (i *Interceptor) handleInboundFromRelay(buf []byte, addr *WinDivertAddress,
    ip *IPv4Header, tcp *TCPHeader) {

    workerPort := ntohs(tcp.DstPort)
    entry, ok := i.nat.Get(workerPort)
    if !ok {
        log.Printf("DEBUG inbound: no NAT entry for dst port %d, passing through", workerPort)
        i.handle.Send(buf, addr)
        return
    }

    log.Printf("DEBUG inbound relay→client: restoring %s:%d for port %d",
        entry.OrigDstIP, entry.OrigDstPort, workerPort)

    copy(ip.SrcIP[:], entry.OrigDstIP.To4())
    tcp.SrcPort = htons(entry.OrigDstPort)
    copy(ip.DstIP[:], entry.OrigSrcIP.To4())

    addr.Flags |= 1 << 18  // loopback
    addr.SetOutbound(false)

    if tcp.Flags&(TCP_FLAG_FIN|TCP_FLAG_RST) != 0 {
        i.nat.Delete(workerPort)
    }

    CalcChecksums(buf, addr)
    i.handle.Send(buf, addr)
}

func (i *Interceptor) isTargetProcess(srcPort uint16) bool {
    portToPID, err := GetPortToPID()
    if err != nil {
        return false
    }
    pid, ok := portToPID[srcPort]
    if !ok {
        return false
    }
    targetPIDs, err := GetPIDsByName(i.processName)
    if err != nil {
        return false
    }
    return targetPIDs[pid]
}

func itoa(n uint16) string {
    return string([]byte{
        byte('0' + n/10000),
        byte('0' + (n/1000)%10),
        byte('0' + (n/100)%10),
        byte('0' + (n/10)%10),
        byte('0' + n%10),
    }[5-lenUint16(n):])
}

func lenUint16(n uint16) int {
    switch {
    case n >= 10000:
        return 5
    case n >= 1000:
        return 4
    case n >= 100:
        return 3
    case n >= 10:
        return 2
    default:
        return 1
    }
}