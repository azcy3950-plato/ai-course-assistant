import { describe, it, expect } from 'vitest';
import { modifyLid, LID_STRATEGIES } from '../src/app/api/swmm/route';

// 带 [LID_CONTROLS] 与 [LID_USAGE] 的构造 INP 文本(冻结期 modifyLid 不应做任何重分配)
const makeInp = () => [
  '[TITLE]',
  '[LID_CONTROLS]',
  '绿色屋顶\tGR\t0\t1\t0.15\t0.2\t0.1\t0\t0\t0\t0',
  '透水砖铺装\tPP\t0\t1\t0.1\t0.12\t0.08\t0\t0\t0\t0',
  '[LID_USAGE]',
  'C1\t绿色屋顶\t1\t100\t0\t0\t0\t0\t*\t*\t0',
  'C2\t透水砖铺装\t1\t200\t0\t0\t0\t0\t*\t*\t0',
  '[OUTFALLS]',
  'OUT\t999\t0\tFREE\tNO',
].join('\n');

const lidUsage = (text: string) => {
  const s = text.indexOf('[LID_USAGE]');
  const e = text.indexOf('[', s + 1);
  return text.slice(s, e < 0 ? text.length : e);
};

describe('LID 冻结(frozen):双轨开发安全边界回归', () => {
  it('现状基准(不带 lidStrategy)不修改 [LID_USAGE]', () => {
    const inp = makeInp();
    const r = modifyLid(inp, undefined);
    expect(r.applied).toBe(false);
    expect(r.text).toBe(inp);
    expect(lidUsage(r.text)).toBe(lidUsage(inp));
  });

  it.each(Object.keys(LID_STRATEGIES))(
    '冻结状态下 lidStrategy=%s 返回 applied=false 且 [LID_USAGE] 保持原样',
    (strategy) => {
      const inp = makeInp();
      const r = modifyLid(inp, strategy);
      expect(r.applied).toBe(false);
      expect(lidUsage(r.text)).toBe(lidUsage(inp));
      // 冻结期绝不能写入策略的比例(避免 UI 显示策略而 INP 未真实实现)
      expect(r.text.indexOf('C1\t绿色屋顶\t1\t')).toBeGreaterThan(-1);
    },
  );
});
