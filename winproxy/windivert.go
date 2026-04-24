package main

import (
    "log"
    "net"
    "syscall"
    "unsafe"
)

var (
    winDivert         = syscall.NewLazyDLL("WinDivert.dll")
    procOpen          = winDivert.NewProc("WinDivertOpen")
    procRecv          = winDivert.NewProc("WinDivertRecv")
    procSend          = winDivert.NewProc("WinDivertSend")
    procClose         = winDivert.NewProc("WinDivertClose")
    procCalcChecksums = winDivert.NewProc("WinDivertHelperCalcChecksums")
)

const (
    WINDIVERT_LAYER_NETWORK = 0
    WINDIVERT_FLAG_DEFAULT  = 0
    WINDIVERT_FLAG_SNIFF    = 2
)

type WinDivertAddress struct {
    Timestamp int64
    Flags     uint32
    Data      [64]byte
}

func (a *WinDivertAddress) IsOutbound() bool { return a.Flags&(1<<17) != 0 }
func (a *WinDivertAddress) IsLoopback() bool { return a.Flags&(1<<18) != 0 }
func (a *WinDivertAddress) SetOutbound(v bool) {
    if v {
        a.Flags |= 1 << 17
    } else {
        a.Flags &^= 1 << 17
    }
}

type Handle uintptr

func WinDivertOpen(filter string, layer, priority int, flags uint64) (Handle, error) {
    f, _ := syscall.BytePtrFromString(filter)
    h, _, err := procOpen.Call(
        uintptr(unsafe.Pointer(f)),
        uintptr(layer),
        uintptr(priority),
        uintptr(flags),
    )
    if h == ^uintptr(0) {
        return 0, err
    }
    return Handle(h), nil
}

func (h Handle) Recv(buf []byte) (int, *WinDivertAddress, error) {
    var addr WinDivertAddress
    var n uint32
    r, _, err := procRecv.Call(
        uintptr(h),
        uintptr(unsafe.Pointer(&buf[0])),
        uintptr(len(buf)),
        uintptr(unsafe.Pointer(&n)),
        uintptr(unsafe.Pointer(&addr)),
    )
    if r == 0 {
        return 0, nil, err
    }
    return int(n), &addr, nil
}

func (h Handle) Send(buf []byte, addr *WinDivertAddress) error {
    var n uint32
    r, _, err := procSend.Call(
        uintptr(h),
        uintptr(unsafe.Pointer(&buf[0])),
        uintptr(len(buf)),
        uintptr(unsafe.Pointer(&n)),
        uintptr(unsafe.Pointer(addr)),
    )
    if r == 0 {
        log.Printf("WinDivertSend error: %v", err)
        return err
    }
    return nil
}

func (h Handle) Close() { procClose.Call(uintptr(h)) }

func CalcChecksums(buf []byte, addr *WinDivertAddress) {
    procCalcChecksums.Call(
        uintptr(unsafe.Pointer(&buf[0])),
        uintptr(len(buf)),
        uintptr(unsafe.Pointer(addr)),
        0,
    )
}

type IPv4Header struct {
    VersionIHL uint8
    TOS        uint8
    Length     uint16
    ID         uint16
    FragOff    uint16
    TTL        uint8
    Protocol   uint8
    Checksum   uint16
    SrcIP      [4]byte
    DstIP      [4]byte
}

type TCPHeader struct {
    SrcPort  uint16
    DstPort  uint16
    SeqNum   uint32
    AckNum   uint32
    DataOff  uint8
    Flags    uint8
    Window   uint16
    Checksum uint16
    Urgent   uint16
}

const (
    TCP_FLAG_SYN = 0x02
    TCP_FLAG_ACK = 0x10
    TCP_FLAG_FIN = 0x01
    TCP_FLAG_RST = 0x04
)

func parseIPv4TCP(buf []byte) (*IPv4Header, *TCPHeader, bool) {
    if len(buf) < 20 {
        return nil, nil, false
    }
    ip := (*IPv4Header)(unsafe.Pointer(&buf[0]))
    if ip.Protocol != 6 {
        return nil, nil, false
    }
    ipHdrLen := int(ip.VersionIHL&0x0F) * 4
    if len(buf) < ipHdrLen+20 {
        return nil, nil, false
    }
    tcp := (*TCPHeader)(unsafe.Pointer(&buf[ipHdrLen]))
    return ip, tcp, true
}

func isSYN(tcp *TCPHeader) bool {
    return tcp.Flags&TCP_FLAG_SYN != 0 && tcp.Flags&TCP_FLAG_ACK == 0
}

func ntohs(v uint16) uint16 { return (v >> 8) | (v << 8) }
func htons(v uint16) uint16 { return (v >> 8) | (v << 8) }

func ip4ToNet(b [4]byte) net.IP { return net.IP{b[0], b[1], b[2], b[3]} }
func netToIP4(ip net.IP) [4]byte {
    ip = ip.To4()
    return [4]byte{ip[0], ip[1], ip[2], ip[3]}
}