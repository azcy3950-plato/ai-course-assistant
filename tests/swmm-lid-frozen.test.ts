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

describe('LID 策略真实重分配回归', () => {
  it('现状基准(不带 lidStrategy)不修改 [LID_USAGE]', () => {
    const inp = makeInp();
    const r = modifyLid(inp, undefined);
    expect(r.applied).toBe(false);
    expect(r.text).toBe(inp);
    expect(lidUsage(r.text)).toBe(lidUsage(inp));
  });

  it.each(Object.keys(LID_STRATEGIES))(
    '策略 lidStrategy=%s 返回 applied=true 且 [LID_USAGE] 面积被重分配(保留前部[LID_CONTROLS])',
    (strategy) => {
      const inp = makeInp();
      const r = modifyLid(inp, strategy);
      expect(r.applied).toBe(true);
      // 必须保留 [LID_USAGE] 之前的整段([LID_CONTROLS] 前置段),否则 SWMM 找不到汇水区
      expect(r.text.startsWith('[TITLE]')).toBe(true);
      expect(r.text.indexOf('[LID_CONTROLS]')).toBeLessThan(r.text.indexOf('[LID_USAGE]'));
      // 面积被重分配:与原始不同
      expect(lidUsage(r.text)).not.toBe(lidUsage(inp));
      expect(r.text.indexOf('C1\t绿色屋顶\t1\t')).toBeGreaterThan(-1);
    },
  );
});
