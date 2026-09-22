import { defineConfig, type UserConfigExport } from "@tarojs/cli";
import TsconfigPathsPlugin from "tsconfig-paths-webpack-plugin";
import pkg from "../package.json";
import devConfig from "./dev";
import prodConfig from "./prod";

// 构建期注入的常量(类型声明见 src/config/types.ts,读取走 src/config/index.ts 的
// getAppVersion() / getBuildTime()),供上报公共参数与问题定位使用。
// defineConstants 的值会原样交给 webpack DefinePlugin,字符串必须 JSON.stringify 后再注入,
// 否则产物里会留下未加引号的裸标识符。
const appVersion = JSON.stringify(pkg.version);
const buildTime = JSON.stringify(new Date().toISOString());

// https://docs.taro.zone/docs/config#defineconfig-辅助函数
export default defineConfig<"webpack5">(async (merge) => {
  const baseConfig: UserConfigExport<"webpack5"> = {
    projectName: "cms-miniapp",
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      375: 2,
      828: 1.81 / 2
    },
    sourceRoot: "src",
    outputRoot: "dist",
    defineConstants: {
      __APP_VERSION__: appVersion,
      __BUILD_TIME__: buildTime
    },
    copy: {
      patterns: [],
      options: {}
    },
    framework: "react",
    compiler: "webpack5",
    mini: {
      postcss: {
        pxtransform: {
          enable: true,
          config: {}
        },
        cssModules: {
          enable: false, // 默认为 false,如需使用 css modules 功能,则设为 true
          config: {
            namingPattern: "module", // 转换模式,取值为 global/module
            generateScopedName: "[name]__[local]___[hash:base64:5]"
          }
        }
      },
      webpackChain(chain) {
        chain.resolve.plugin("tsconfig-paths").use(TsconfigPathsPlugin);
      }
    }
  };

  if (process.env.NODE_ENV === "development") {
    // 本地开发构建配置(不混淆压缩)
    return merge({}, baseConfig, devConfig);
  }
  // 生产构建配置(默认开启压缩混淆等)
  return merge({}, baseConfig, prodConfig);
});
