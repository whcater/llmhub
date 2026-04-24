flow: 
workerd.exe
  │ connect(8.8.8.8:443)  ← 原始意图
  ▼
WinDivert（拦截 SYN 包）
  │ 记录: srcPort 54321 → 原始目标 8.8.8.8:443
  │ 改写: dst → 127.0.0.1:17890
  ▼
本地 Relay（:17890）
  │ accept() 拿到 srcPort 54321
  │ 查表得到 8.8.8.8:443
  ▼
SOCKS5 代理 → 真实服务器

返回方向：
WinDivert 拦截 relay→workerd 的包
  改写 src: 127.0.0.1:17890 → 8.8.8.8:443  ← workerd 以为在跟真服务器说话


prepare: 
设置一下 Go 的下载代理：
go env -w GOPROXY=https://goproxy.cn,direct
然后再重新运行：
go get golang.org/x/sys/windows


构建和运行
1. 下载 WinDivert
去 https://reqrypt.org/windivert.html 下载，把 WinDivert.dll 和 WinDivert.sys（x64版）放到项目目录。
2. 依赖
bashgo mod init winproxy
go get golang.org/x/sys/windows
3. 编译（需要以管理员身份）
bash
GOARCH=amd64 GOOS=windows go build -o winproxy.exe .
or
go build -o winproxy.exe .


4. 运行
bash# 以管理员身份运行（WinDivert 需要）
winproxy.exe -p workerd.exe -proxy socks5://127.0.0.1:7890
winproxy.exe -p curl.exe -proxy socks5://127.0.0.1:15715
Test: 
.\winproxy.exe -p workerd.exe -proxy socks5://127.0.0.1:15715 -noproxy "127.0.0.1,localhost,192.168.0.0/16,10.0.0.0/8"
.\winproxy.exe -p curl.exe -proxy socks5://127.0.0.1:15715 -noproxy "127.0.0.1,localhost,192.168.0.0/16,10.0.0.0/8"

还有一个坑需要注意
WinDivert 做入站包改写时，ip.SrcIP 被改成了原始服务器 IP（如 8.8.8.8），但这个包实际是从 loopback 来的。Windows 的 TCP 栈可能会因为 RPF（反向路径过滤）拒掉它。
解决办法：在 WinDivertOpen 里加 WINDIVERT_FLAG_SNIFF(2) + 手动设 addr.Loopback = 0，或者改用 WinDivert 的 FORWARD 层。这是最后剩的一个需要调试的点

