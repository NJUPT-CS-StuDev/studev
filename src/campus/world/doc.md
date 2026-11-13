行内公式 $E=mc^2$，分式 $\frac{a}{b}$ 与中文 $\text{速度}\;v=\frac{\Delta s}{\Delta t}$。

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx=\sqrt{\pi}
$$

$$
\begin{pmatrix}1&2\\3&4\end{pmatrix}\qquad\sum_{n=1}^{\infty}\frac{1}{n^2}=\frac{\pi^2}{6}
$$

$$
(a+b)^n=\sum_{k=0}^n\binom{n}{k}a^{n-k}b^k=\binom{n}{0}a^n+\binom{n}{1}a^{n-1}b+\cdots+\binom{n}{n}b^n
$$

```mermaid
flowchart TD
  A[打开 App] --> B{已登录？}
  B -->|是| C[进入课表]
  B -->|否| D[登录]
  D --> C
```

```mermaid
sequenceDiagram
  actor 学生
  participant App
  participant AI
  学生->>App: 提问
  App->>AI: 转发
  AI-->>App: 流式回答
  App-->>学生: 显示
```

> [!TIP]
> **加粗**，==重点==、H~2~O 和 x^2^ 都保留格式。

| 时间 | 地点 | 说明 |
| :--- | :---: | ---: |
| 周一 11:25 | 教3-302 | 空闲 |
| 周三 12:00 | 图书馆 | 午饭后 |

- [x] 已完成
- [ ] 待处理

```rust
fn main() { println!("你好"); }
```
