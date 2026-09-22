import { Zip, ZipPassThrough } from "fflate";

import { uniqueName } from "../file-name";

/**
 * 流式 zip 写入器(阶段 10,整条链路的内存关键点)。
 *
 * 为什么必须流式:50 张中档成品约 200MB。若先把产物 Blob 攒进数组、最后一次性打包,
 * 这 200MB 会全程驻留;而「渲染完一张立刻写一张」让在途产物数等于并发数(≤4)。
 * 决策 D5 又要求产物只有「一个 zip」(移动端逐张下载不可用),所以流式写入是这两条的交集。
 *
 * 为什么是 STORE(压缩方法 0):JPEG 字节已经是熵编码结果,再套 deflate 省不下体积,
 * 只烧 CPU 并拖长移动端发热时间。`ZipPassThrough` 的 `compression` 恒为 0,这就是
 * 方案里「`Zip({ level: 0 })`」在 fflate 0.8 的实际形态——该版本的 `Zip` 构造函数
 * 只接受回调、不接受压缩选项,传选项会把回调位置占掉(有用例断言落盘方法是 STORE)。
 *
 * 依赖纪律:只在主线程使用(Worker 里没有落盘需求),不 import react/store。
 */

/** zip 产物的 MIME;页面下载时 anchor 靠它认类型。 */
export const ZIP_MIME_TYPE = "application/zip";

/** 打包环节失败的人话前缀(与渲染失败区分开:降档救不了打包失败)。 */
export const PACK_FAILURE_PREFIX = "压缩包写入失败";

export interface ZipWriter {
  /**
   * 追加一个文件:内部完成同名去重(`a.jpg` → `a-2.jpg`),返回 zip 里最终落定的名字。
   * 本函数会把 Blob 取成一次 `Uint8Array` 交给 fflate,自己不留下任何产物引用。
   */
  add(candidateName: string, blob: Blob): Promise<string>;
  /** 收尾:写中央目录并返回整包 Blob(收到最后一个分片才 resolve)。 */
  finish(): Promise<Blob>;
  /** 放弃这一包(取消或全失败):丢弃已累积分片,此后 add/finish 一律报错。 */
  discard(): void;
}

const packError = (reason: string): Error => new Error(`${PACK_FAILURE_PREFIX}: ${reason}`);

/**
 * `Zip` 的 ondata 会把每个分片交出来。分片必须**逐片转 Blob**:
 * Blob 的字节由浏览器管理(大 Blob 会落盘),留在 JS 堆里的只有一个几十字节的引用;
 * 攒 `Uint8Array[]` 等于把整包留在堆上,正是要避免的那种写法。
 */
export const createZipWriter = (): ZipWriter => {
  const stream = new Zip();
  const parts: Blob[] = [];
  /** zip 内已占用的名字。去重必须在这里做:同名条目会让解压端只留下最后一个。 */
  const used = new Set<string>();
  let failure: Error | null = null;
  let finalBlob: Blob | null = null;
  let discarded = false;
  let pending: { resolve: (blob: Blob) => void; reject: (reason: Error) => void } | null = null;

  stream.ondata = (error, chunk, last) => {
    if (error) {
      // 只留第一条:后续分片都是同一次故障的余波,叠起来会把用户真正要看的原因埋掉。
      if (!failure) failure = packError(error.message);
      pending?.reject(failure);
      pending = null;
      return;
    }
    if (chunk.length > 0) parts.push(new Blob([chunk]));
    if (!last) return;
    finalBlob = new Blob(parts, { type: ZIP_MIME_TYPE });
    // 分片引用必须清空:此时整包已经在 finalBlob 里,再留一份引用等于双份内存。
    parts.length = 0;
    pending?.resolve(finalBlob);
    pending = null;
  };

  const assertUsable = (): void => {
    if (failure) throw failure;
    if (discarded) throw packError("这一包已被放弃, 请重新开始导出。");
  };

  return {
    async add(candidateName, blob) {
      assertUsable();
      // 先定名再取字节:`uniqueName` 是纯函数(只读 used),登记必须由调用方做;
      // 而且整个「取名 + 登记」要在 await 之前完成,否则两张并发完成的图会拿到同一个名字。
      const name = uniqueName(used, candidateName);
      used.add(name);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      assertUsable();
      const entry = new ZipPassThrough(name);
      stream.add(entry);
      // 一次 push + final:fflate 会立刻把这块字节转交给 ondata,函数返回后本地 bytes 出作用域。
      entry.push(bytes, true);
      return name;
    },

    finish() {
      assertUsable();
      if (finalBlob) return Promise.resolve(finalBlob);
      return new Promise<Blob>((resolve, reject) => {
        // 先挂回调再 end():分片可能在 end() 里同步到达,顺序反了就永远等不到 resolve。
        pending = { resolve, reject };
        stream.end();
      });
    },

    discard() {
      discarded = true;
      finalBlob = null;
      parts.length = 0;
      used.clear();
      if (pending) {
        pending.reject(packError("导出已取消, 未生成压缩包。"));
        pending = null;
      }
    }
  };
};

// ---------------------------------------------------------------- 同名去重

/**
 * zip 内的名字去重走 `utils/file-name.ts` 的 `uniqueName`(与表单展示同一套口径:
 * 序号插在扩展名之前、上千同名退回时间戳),所以本文件不再自带第二套规则。
 */
