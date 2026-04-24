package main

import (
    "fmt"
    "net"
    "sync"
)

type ConnKey struct {
    SrcPort uint16 // workerd 的源端口
}

type ConnEntry struct {
    OrigSrcIP   net.IP
    OrigDstIP   net.IP
    OrigDstPort uint16
}

type NATTable struct {
    mu      sync.RWMutex
    entries map[ConnKey]*ConnEntry
}

func NewNATTable() *NATTable {
    return &NATTable{entries: make(map[ConnKey]*ConnEntry)}
}

func (t *NATTable) Add(srcPort uint16, srcIP, dstIP net.IP, dstPort uint16) {
    t.mu.Lock()
    defer t.mu.Unlock()
    t.entries[ConnKey{srcPort}] = &ConnEntry{
        OrigSrcIP:   srcIP,
        OrigDstIP:   dstIP,
        OrigDstPort: dstPort,
    }
}

func (t *NATTable) Get(srcPort uint16) (*ConnEntry, bool) {
    t.mu.RLock()
    defer t.mu.RUnlock()
    e, ok := t.entries[ConnKey{srcPort}]
    return e, ok
}

func (t *NATTable) Delete(srcPort uint16) {
    t.mu.Lock()
    defer t.mu.Unlock()
    delete(t.entries, ConnKey{srcPort})
}

func (e *ConnEntry) String() string {
    return fmt.Sprintf("%s:%d", e.OrigDstIP, e.OrigDstPort)
}