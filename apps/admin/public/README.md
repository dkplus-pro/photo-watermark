# public/ 静态资源

本目录随包发布,是「水印相框」唯一的数据来源(本站无服务端)。
所有引用都经 `src/utils/asset-url.ts` 的 `assetUrl(path)` 拼接部署前缀,因此:

- 清单里的 `thumbnail` / `source` 写的是**相对本目录根的路径,不带前导 `/`**(例:`assets/logos/juzi.svg`);
- 写成 `/assets/...` 在 GitHub Pages 子路径(`/photo-watermark/`)下必然 404。

```
public/
  frames.json                 相框清单
  logos.json                  logo 预设清单
  assets/brand/logo.png       侧栏/顶栏应用 logo
  assets/logos/*.svg          logo 预设图(清单 source 指向此处)
  assets/thumbs/*.svg         相框缩略图(清单 thumbnail 指向此处)
  fonts/*.woff2               相框绘制用 webfont(见第 4 节)
```

## 1. 怎么换应用 logo

替换 `assets/brand/logo.png` 的内容即可,文件名保持不变(壳层按 `assetUrl("assets/brand/logo.png")` 引用)。
建议 48×48 的方形 viewBox、单色深灰 `#09090b`,透明底。

## 2. 怎么换 / 加 logo 预设

1. 把图片放进 `assets/logos/`,文件名即清单项的 `source`(相对本目录根);
2. 在 `logos.json` 的 `logos` 数组里加一条:

```json
{ "id": "juzi", "name": "芥子科技", "source": "assets/logos/juzi.svg", "mark": "JUZI" }
```

- `id` 全清单唯一(重复会在装载期直接报错);
- `name` 是表单展示名;
- `mark` 是**文字兜底**:预设图缺失、或用户改用了自定义上传的图而解码失败时,绘制端 `drawLogoMark`
  会用 `mark` 在信息条上画一个浅色文字块。写短英文全大写最稳(字号按信息条比例算,过长会被截断成 `…`);
- 预设图会**原样绘制在黑色信息条上**,所以图形请用浅色(如 `#fafafa`),深色 logo 会糊成一片。

清单里**不要**写「自定义上传」这一项 —— 它是 UI 层固定追加的入口,不是资源。

`logos.json` 里的项无需 `sortOrder`,列表按 `id` 字典序展示。

## 3. 怎么加新相框(两处必须同时改)

JSON 只做清单,具体画法走代码分支(决策 D2),所以:

1. 在 `src/utils/frame/frame-drawing.ts`(或同目录新文件)里实现
   `DrawFrameComposition` 同签名的绘制函数,并在 `src/utils/frame/style-registry.ts`
   注册 `styleId`;
2. 在 `frames.json` 加一条:

```json
{
  "id": "plain-frame",
  "name": "基础黑框",
  "thumbnail": "assets/thumbs/plain-frame.jpg",
  "sortOrder": 10
}
```

- `id` 必须**逐字等于**注册表里的 styleId。清单里有、注册表没有 → 装载期直接抛
  `CatalogError`,页面显示错误而不是安静地少一个相框(刻意不静默回落);
- `sortOrder` 是升序展示值,必须是 ≥1 的整数;重复允许(同值按 `id` 稳定排序)。
  取 10/20/30 这类间隔,留出插队余地;
- 多余字段会被忽略,可以放注释性键做前向兼容。

**缩略图必须与真实导出观感一致**:请按导出结果的排版画(或渲)——黑底、照片满幅、
底部 20% 高的信息条渐变、左侧 logo 块 + 细分隔竖线 + 两行 EXIF 文字。
最稳的做法:在导出页用一张示例照片导出成图,把它缩到 320×240 另存为
`assets/thumbs/<styleId>.svg`(或直接引用该位图),覆盖旧缩略图。
观感对不上的缩略图会让用户在列表里选错样式,比报错更难排查。

## 4. 字体

`fonts/` 下三个文件的名字**不可改**,它们写死在 `src/utils/frame/fonts.ts` 的 `FRAME_FONTS` 里:

| 文件                               | 来源                                                                  | 用途                            |
| ---------------------------------- | --------------------------------------------------------------------- | ------------------------------- |
| `jost-latin-400-normal.woff2`      | npm `@fontsource/jost`(`files/jost-latin-400-normal.woff2`)           | 信息条参数行、logo 文字块主字体 |
| `jost-latin-700-normal.woff2`      | npm `@fontsource/jost`(`files/jost-latin-700-normal.woff2`)           | logo 文字块粗体                 |
| `fira-sans-latin-400-normal.woff2` | npm `@fontsource/fira-sans`(`files/fira-sans-latin-400-normal.woff2`) | 参数行等宽数字                  |

取法(不往仓库 `package.json` 加依赖):

```
mkdir -p /tmp/fontsource && cd /tmp/fontsource
npm pack @fontsource/jost @fontsource/fira-sans
tar -xzf fontsource-jost-*.tgz -C jost --one-top-level
cp jost/package/files/jost-latin-400-normal.woff2  <repo>/apps/admin/public/fonts/
cp jost/package/files/jost-latin-700-normal.woff2  <repo>/apps/admin/public/fonts/
tar -xzf fontsource-fira-sans-*.tgz
cp package/files/fira-sans-latin-400-normal.woff2  <repo>/apps/admin/public/fonts/
```

字体缺失**不会**让导出失败:`loadFrameFonts` 整体 try/catch 降级,Canvas 会退回
`PRIMARY_FONT_STACK` / `MONO_FONT_STACK` 里的系统字体,观感降级但产物仍然出得来。
**不要**为了「让文件存在」放假字体的空文件——空 woff2 会让注册成功但字形全缺,
比直接缺失更难诊断。

## 5. 改完自查

`pnpm --filter @monorepo-template/admin test` 里的「仓库自带清单自检」用例会读磁盘上的
`frames.json` / `logos.json` 跑一遍守卫,并确认 JSON 引用的 `assets/**`、`fonts/**` 文件真实存在。
改了清单忘了改注册表、或者删了图没删清单,这条用例会红。
