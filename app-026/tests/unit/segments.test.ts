import { describe, expect, it } from 'vitest'
import {
  removeLineFromSegments,
  insertLineIntoSegments,
  splitSegmentAtLine,
  segmentRanges,
} from '../../src/engine/segments'
import { parseScriptText } from '../../src/engine/parse'
import type { Line, Script, Segment } from '../../src/types'

const mkLines = (n: number): Line[] =>
  Array.from({ length: n }, (_, i) => ({ id: `l${i + 1}`, text: `句${i + 1}`, cues: [], marks: [] }))

const mkScript = (lines: Line[], segments: Segment[]): Script => ({
  id: 'sc_t',
  title: '测试',
  lines,
  segments,
  style: 'opera',
  updatedAt: 0,
})

/** 不变量：每行恰好属于一个段；段内/段间顺序与行序一致 */
const expectConsistent = (lines: Line[], segments: Segment[]) => {
  const member = segments.flatMap((s) => s.lineIds)
  expect(new Set(member).size).toBe(member.length) // 不重
  expect(member.slice().sort()).toEqual(lines.map((l) => l.id).slice().sort()) // 不漏
  const pos = new Map(lines.map((l, i) => [l.id, i] as const))
  for (const seg of segments) {
    const idxs = seg.lineIds.map((id) => pos.get(id)!)
    expect(idxs).toEqual(idxs.slice().sort((a, b) => a - b)) // 段内顺序与行序一致
  }
}

/** 段区间首尾相接覆盖全部行 → 跳段不会跳过任何一行 */
const expectRangesTile = (script: Script) => {
  const ranges = segmentRanges(script)
  expect(ranges[0].start).toBe(0)
  for (let i = 1; i < ranges.length; i++) expect(ranges[i].start).toBe(ranges[i - 1].end)
  expect(ranges[ranges.length - 1].end).toBe(script.lines.length)
}

describe('删行：removeLineFromSegments', () => {
  const segments: Segment[] = [
    { id: 's1', title: '慢板', lineIds: ['l1', 'l2', 'l3'], loop: true },
    { id: 's2', title: '快板', lineIds: ['l4', 'l5'] },
  ]

  it('删掉段首句：段头锚点移到下一句，段名/循环/句数保持正确', () => {
    const out = removeLineFromSegments(segments, 'l1')
    expect(out[0]).toMatchObject({ id: 's1', title: '慢板', loop: true, lineIds: ['l2', 'l3'] })
    expect(out[0].lineIds[0]).toBe('l2') // 段头重新有落点，名字可继续改
  })

  it('删中间句：只移除该 id', () => {
    expect(removeLineFromSegments(segments, 'l2')[0].lineIds).toEqual(['l1', 'l3'])
  })

  it('未受影响的段保持原引用', () => {
    expect(removeLineFromSegments(segments, 'l1')[1]).toBe(segments[1])
  })

  it('删掉段内唯一一句：整段移除', () => {
    const segs: Segment[] = [
      { id: 's1', title: 'A', lineIds: ['l1'] },
      { id: 's2', title: 'B', lineIds: ['l2'] },
    ]
    const out = removeLineFromSegments(segs, 'l1')
    expect(out.map((s) => s.id)).toEqual(['s2'])
    expect(out[0]).toBe(segs[1])
  })
})

describe('插行：insertLineIntoSegments', () => {
  const lines = mkLines(4)
  const segments: Segment[] = [
    { id: 's1', title: 'A', lineIds: ['l1', 'l2'] },
    { id: 's2', title: 'B', lineIds: ['l3', 'l4'] },
  ]

  it('段中间插入：新句紧跟 anchor，归同一段', () => {
    const out = insertLineIntoSegments(segments, lines, 'new', 'l1')
    expect(out[0].lineIds).toEqual(['l1', 'new', 'l2'])
    expect(out[1]).toBe(segments[1])
  })

  it('段末插入：归前一段，不进下一段', () => {
    const out = insertLineIntoSegments(segments, lines, 'new', 'l2')
    expect(out[0].lineIds).toEqual(['l1', 'l2', 'new'])
    expect(out[1].lineIds).toEqual(['l3', 'l4'])
  })

  it('anchor 不在任何段（遗留数据）：挂到前面最近的有段行所在段', () => {
    const orphanLines = mkLines(3) // l2 是孤儿
    const segs: Segment[] = [
      { id: 's1', title: 'A', lineIds: ['l1'] },
      { id: 's2', title: 'B', lineIds: ['l3'] },
    ]
    const out = insertLineIntoSegments(segs, orphanLines, 'new', 'l2')
    expect(out[0].lineIds).toEqual(['l1', 'new'])
  })

  it('anchor 之前没有有段行：插到后面段的段首之前', () => {
    const orphanLines = mkLines(2) // l1 是孤儿
    const segs: Segment[] = [{ id: 's1', title: 'A', lineIds: ['l2'] }]
    const out = insertLineIntoSegments(segs, orphanLines, 'new', 'l1')
    expect(out[0].lineIds).toEqual(['new', 'l2'])
  })

  it('全文无段：新建一段装新行', () => {
    const out = insertLineIntoSegments([], lines, 'new', 'l1', () => 'sX')
    expect(out).toEqual([{ id: 'sX', title: '第1段', lineIds: ['new'] }])
  })
})

describe('剪段：splitSegmentAtLine', () => {
  const segments: Segment[] = [
    { id: 's1', title: '引子', lineIds: ['l1', 'l2'] },
    { id: 's2', title: '慢板', lineIds: ['l3', 'l4', 'l5'], loop: true },
    { id: 's3', title: '尾声', lineIds: ['l6'] },
  ]

  it('从第 2 段中间剪开：只动该段，前后段原样保留', () => {
    const out = splitSegmentAtLine(segments, 'l4', () => 'sNew')
    expect(out.map((s) => s.id)).toEqual(['s1', 's2', 'sNew', 's3'])
    expect(out[0]).toBe(segments[0]) // 前面的段不被并掉
    expect(out[3]).toBe(segments[2]) // 后面的段不被并掉
    expect(out[1]).toMatchObject({ id: 's2', title: '慢板', loop: true, lineIds: ['l3'] }) // 原段保留段名/循环
    expect(out[2]).toMatchObject({ title: '第3段', lineIds: ['l4', 'l5'] }) // 新段紧随原段
  })

  it('段首行不剪（已是段头）', () => {
    expect(splitSegmentAtLine(segments, 'l3')).toBe(segments)
  })

  it('行不在任何段不剪', () => {
    expect(splitSegmentAtLine(segments, 'zzz')).toBe(segments)
  })
})

describe('编辑序列后「行 ↔ 段」始终一致', () => {
  it('删首句 → 插中句 → 中间剪开，段区间始终覆盖全部行', () => {
    const parsed = parseScriptText('## 引子\n生：A1\n生：A2\n\n## 慢板\n旦：B1\n旦：B2\n旦：B3\n\n## 尾声\n生：C1')
    let lines = parsed.lines
    let segments = parsed.segments
    expect(segments.map((s) => s.title)).toEqual(['引子', '慢板', '尾声'])

    // 1) 删掉第一段的第一句 → 段不消失，句数减一
    segments = removeLineFromSegments(segments, lines[0].id)
    lines = lines.slice(1)
    expect(segments.length).toBe(3)
    expect(segments[0]).toMatchObject({ title: '引子', lineIds: [lines[0].id] })
    expectConsistent(lines, segments)
    expectRangesTile(mkScript(lines, segments))

    // 2) 在第二段中间补一句 → 落进第二段
    const anchor = lines[2] // 慢板 B2
    const nl: Line = { id: 'l_new', text: '补一句', cues: [], marks: [] }
    const at = lines.findIndex((l) => l.id === anchor.id)
    segments = insertLineIntoSegments(segments, lines, nl.id, anchor.id)
    lines = [...lines.slice(0, at + 1), nl, ...lines.slice(at + 1)]
    expect(segments[1].lineIds).toContain(nl.id)
    expectConsistent(lines, segments)
    expectRangesTile(mkScript(lines, segments))

    // 3) 从第二段中间剪开（B3 处）→ 只多一段，其余段名不动
    const before = segments.map((s) => s.title)
    segments = splitSegmentAtLine(segments, lines[4].id, () => 's_cut')
    expect(segments.length).toBe(4)
    expect(segments.map((s) => s.title)).toEqual([before[0], before[1], '第3段', before[2]])
    expectConsistent(lines, segments)
    expectRangesTile(mkScript(lines, segments))
  })
})
