# 数学公式显示检查

## 1. 行内公式

文字中的 $E=mc^2$，以及 $x_i^2+y_i^2=r^2$，应与正文正常衔接。

## 2. 嵌套分式与根式

$$
x=\frac{-b\pm\sqrt{b^2-4ac}}{2a},\qquad
\sqrt[3]{\frac{1+\frac{1}{x}}{1-\frac{1}{x}}}
$$

## 3. 上下标与组合数

$$
a_{i_j}^{n+1}\qquad {}^{14}_{6}\mathrm{C}\qquad
\binom{n}{k}=\frac{n!}{k!(n-k)!}
$$

## 4. 求和、乘积与极限

$$
\sum_{n=1}^{\infty}\frac{1}{n^2}=\frac{\pi^2}{6}\qquad
\prod_{k=1}^{n}k=n!\qquad
\lim_{x\to0}\frac{\sin x}{x}=1
$$

## 5. 积分、二重积分与闭合积分

$$
\int_0^1 x^2\,\mathrm{d}x=\frac13\qquad
\iint_D f(x,y)\,\mathrm{d}x\,\mathrm{d}y\qquad
\oint_C \mathbf{F}\cdot\mathrm{d}\mathbf{r}
$$

## 6. 矩阵与行列式

$$
A=\begin{pmatrix}1&2&3\\4&5&6\\7&8&9\end{pmatrix}\qquad
B=\begin{bmatrix}a&b\\c&d\end{bmatrix}\qquad
\det B=\begin{vmatrix}a&b\\c&d\end{vmatrix}
$$

## 7. 分段函数

$$
f(x)=\begin{cases}x^2,&x\geq0,\\-x,&x<0.\end{cases}
$$

## 8. 多行对齐

$$
\begin{aligned}
(a+b)^2&=(a+b)(a+b)\\
&=a^2+2ab+b^2
\end{aligned}
$$

## 9. 自动伸缩括号

$$
\left\{\left[\frac{1}{1+\left(\frac{x}{y}\right)^2}\right]\right\}
\qquad\left.\frac{\mathrm{d}f}{\mathrm{d}x}\right|_{x=0}
$$

## 10. 向量、重音与上下括号

$$
\vec{v},\quad\hat{x},\quad\bar{x},\quad\dot{x},\quad
\ddot{x},\quad\overline{AB}
$$

$$
\underbrace{a+\cdots+a}_{n\text{ 个}}\qquad
\overbrace{1+2+\cdots+n}^{n\text{ 项}}
$$

## 11. 集合、逻辑、特殊字体与运算符

$$
\forall x\in\mathbb{R},\quad\exists n\in\mathbb{N},\quad
A\subseteq B,\quad A\cap B=\varnothing
$$

$$
\mathcal{L},\quad\mathfrak{g},\quad\boldsymbol{\alpha},\quad
\operatorname{rank}(A),\quad a\equiv b\pmod n,\quad
x\xrightarrow{n\to\infty}0
$$

## 12. 中文文字、间距与长公式

$$
P(A\mid B)=\frac{P(B\mid A)P(A)}{P(B)}\qquad
\text{其中 }P(B)>0
$$

$$
\frac{\partial^2 u}{\partial t^2}=c^2\left(
\frac{\partial^2 u}{\partial x^2}+
\frac{\partial^2 u}{\partial y^2}+
\frac{\partial^2 u}{\partial z^2}\right)
$$

## 13. Markdown 边界

代码中的 `$x^2$` 应保持原样。

转义的美元符号：\$100 和 \$200。

相邻行内公式：$a$、$b$、$c$。
