package main

import (
    "encoding/binary"
    "fmt"
    "syscall"
    "unsafe"

    "golang.org/x/sys/windows"
)

// GetExtendedTcpTable 返回 TCP 连接 → PID 映射
// 用来判断某个 srcPort 是否属于目标进程

const (
    AF_INET                = 2
    TCP_TABLE_OWNER_PID_ALL = 5
)

type MIB_TCPROW_OWNER_PID struct {
    State      uint32
    LocalAddr  uint32
    LocalPort  uint32
    RemoteAddr uint32
    RemotePort uint32
    OwningPID  uint32
}

var (
    iphlpapi            = syscall.NewLazyDLL("iphlpapi.dll")
    getExtendedTcpTable = iphlpapi.NewProc("GetExtendedTcpTable")
)

func GetPortToPID() (map[uint16]uint32, error) {
    var size uint32 = 4096
    var buf []byte
    for {
        buf = make([]byte, size)
        r, _, _ := getExtendedTcpTable.Call(
            uintptr(unsafe.Pointer(&buf[0])),
            uintptr(unsafe.Pointer(&size)),
            1, // sorted
            AF_INET,
            TCP_TABLE_OWNER_PID_ALL,
            0,
        )
        if r == 0 {
            break
        }
        if r == 122 { // ERROR_INSUFFICIENT_BUFFER
            continue
        }
        return nil, fmt.Errorf("GetExtendedTcpTable: %d", r)
    }

    numEntries := binary.LittleEndian.Uint32(buf[0:4])
    result := make(map[uint16]uint32)
    for i := 0; i < int(numEntries); i++ {
        offset := 4 + i*int(unsafe.Sizeof(MIB_TCPROW_OWNER_PID{}))
        row := (*MIB_TCPROW_OWNER_PID)(unsafe.Pointer(&buf[offset]))
        // LocalPort 是 big-endian 的前两字节
        port := binary.BigEndian.Uint16((*[4]byte)(unsafe.Pointer(&row.LocalPort))[:2])
        result[port] = row.OwningPID
    }
    return result, nil
}

func GetPIDsByName(name string) (map[uint32]bool, error) {
    snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
    if err != nil {
        return nil, err
    }
    defer windows.CloseHandle(snap)

    pids := make(map[uint32]bool)
    var pe windows.ProcessEntry32
    pe.Size = uint32(unsafe.Sizeof(pe))

    for err = windows.Process32First(snap, &pe); err == nil; err = windows.Process32Next(snap, &pe) {
        if windows.UTF16ToString(pe.ExeFile[:]) == name {
            pids[pe.ProcessID] = true
        }
    }
    return pids, nil
}