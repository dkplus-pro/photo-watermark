# tests/fixtures

不提交二进制夹具(jpg/png 等):二进制污染 diff,且无法覆盖「畸形段/超限/读取失败」这些异常分支。

- `build-jpeg.ts` — 按 JPEG 段结构合成测试用字节序列(SOI / APP0 / [APP1] / DQT / SOF0 / SOS / 伪扫描数据 / EOI)。
  渲染引擎的 head 解析与零拷贝 splice 只依赖段标志与偏移,不依赖真实压缩数据,故合成序列足以驱动全部代码路径;
  APP1 的 EXIF payload 由 `piexif.dump` 实时生成,与真机产物的段布局一致,并支持缩略图("1st" IFD)与超限 padding 变体。

新增图像类夹具时优先扩展本文件的构造器,而不是放入二进制。
