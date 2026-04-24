package main

import (
    "flag"
    "fmt"
    "log"
    "net/url"
    "os"
    "os/signal"
    "syscall"
)

func main() {
    process := flag.String("p", "workerd.exe", "目标进程名")
    proxy   := flag.String("proxy", "socks5://127.0.0.1:7890", "代理地址")
	noproxy := flag.String("noproxy", "127.0.0.1,localhost", "不走代理的 IP/CIDR，逗号分隔")
    relay   := flag.Int("relay", 17890, "本地 relay 端口")
    flag.Parse()

    proxyURL, err := url.Parse(*proxy)
    if err != nil {
        log.Fatalf("无效的代理地址: %v", err)
    }

    nat := NewNATTable()

    r := NewRelay(*relay, proxyURL, nat)
    i := NewInterceptor(*process, uint16(*relay), nat, ParseNoProxy(*noproxy))

    if err := r.Start(); err != nil {
        log.Fatalf("relay 启动失败: %v", err)
    }
    if err := i.Start(); err != nil {
        log.Fatalf("interceptor 启动失败: %v", err)
    }

    fmt.Printf("✓ 拦截 %s → 代理 %s\n", *process, *proxy)
    fmt.Println("  按 Ctrl+C 退出")

    sig := make(chan os.Signal, 1)
    signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
    <-sig

    i.Stop()
    r.Stop()
}