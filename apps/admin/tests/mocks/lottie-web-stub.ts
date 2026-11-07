// lottie-web 的测试替身:该库模块顶层就操作 canvas(创建 2D 上下文设 fillStyle),
// jsdom 没有真 canvas,顶层求值即抛 TypeError。用例不测 Lottie 动画,
// vitest.config.ts 把 "lottie-web" alias 到本文件,Semi 桶文件便可安全加载。
const lottie = {
  loadAnimation(): unknown {
    return null;
  }
};

export default lottie;
export { lottie };
