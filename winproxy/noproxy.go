package main

import (
    "net"
    "strings"
)

type NoProxyList struct {
    ips    []net.IP
    cidrs  []*net.IPNet
}

func ParseNoProxy(s string) *NoProxyList {
    list := &NoProxyList{}
    for _, item := range strings.Split(s, ",") {
        item = strings.TrimSpace(item)
        if item == "" {
            continue
        }
        if strings.Contains(item, "/") {
            _, cidr, err := net.ParseCIDR(item)
            if err == nil {
                list.cidrs = append(list.cidrs, cidr)
            }
        } else {
            ip := net.ParseIP(item)
            if ip != nil {
                list.ips = append(list.ips, ip)
            }
        }
    }
    return list
}

func (n *NoProxyList) Contains(ip net.IP) bool {
    for _, item := range n.ips {
        if item.Equal(ip) {
            return true
        }
    }
    for _, cidr := range n.cidrs {
        if cidr.Contains(ip) {
            return true
        }
    }
    return false
}