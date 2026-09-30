import { describe, expect, it } from 'vitest'
import type { Line, Segment } from '../../src/types'
import {
  normalizeSegments,
  removeLineFromSegments,
  insertLineIntoSegment,
  splitSegmentAtLine,
} from '../../src/engine/segments'

function makeLines(n: number): Line[] {
  return Array.from({ length: n }, (_, i) => ({ id: `l${i + 1}`, text: `第${i + 1}句`, cues: [], marks: [] }))
}

function seg(id: string, title: string, lineIds: string[], loop?: boolean): Segment {
  return { id, title, lineIds, ...(loop ? { loop: true } : {}) }
}

/** 不变量：每句恰好归属一个段，且无悬空 id、无空段、顺序正确 */
function expectPartition(segments: Segment[], lines: Line[]) {
  const lineIds = new Set(lines.map((l) => l.id))
  const owners = new Map<string, string>()
  for (const s of segments) {
    expect(s.lineIds.length, '段不能为空').toBeGreaterThan(0)
    for (const id of s.lineIds) {
      expect(lineIds.has(id), '不能有悬空 id').toBe(true)
      expect(owners.has(id), '句子不能重复归属').toBe(false)
      owners.set(id, s.id)
    }
  }
  for (const id of lineIds) expect(owners.has(id), `句子 ${id} 必须归属某个段`).toBe(true)
}

describe('删句：从句属段移除', () => {
  it('删掉某段第一句，段仍在（名称/循环/句数可继续编辑）', () => {
    const lines = makeLines(5).filter((l) => l.id !== 'l1') // l1 已从文稿删除
    const segments = [seg('s1', '坐宫', ['l1', 'l2', 'l3'], true), seg('s2', '过关', ['l4', 'l5'])]

    const next = normalizeSegments(lines, removeLineFromSegments(segments, 'l1'))

    expect(next.length).toBe(2)
    expect(next[0]).toMatchObject({ id: 's1', title: '坐宫', loop: true })
    expect(next[0].lineIds).toEqual(['l2', 'l3'])
    expect(next[1].lineIds).toEqual(['l4', 'l5'])
    expectPartition(next, lines)
  })

  it('删掉段中一句，该 id 不留在任何段里', () => {
    const before = makeLines(4)
    const segments = [seg('s1', '甲', ['l1', 'l2']), seg('s2', '乙', ['l3', 'l4'])]
    const lines = before.filter((l) => l.id !== 'l2') // 文稿里同步删除

    const next = normalizeSegments(lines, removeLineFromSegments(segments, 'l2'))
    expect(next.flatMap((s) => s.lineIds)).not.toContain('l2')
    expectPartition(next, lines)
  })

  it('一段只剩一句再删，整段消失，其余段不受影响', () => {
    const lines = makeLines(4)
    const segments = [seg('s1', '甲', ['l1']), seg('s2', '乙', ['l2']), seg('s3', '丙', ['l3', 'l4'])]

    const next = normalizeSegments(lines.filter((l) => l.id !== 'l2'), removeLineFromSegments(segments, 'l2'))

    expect(next.map((s) => s.title)).toEqual(['甲', '丙'])
    expect(next[1].lineIds).toEqual(['l3', 'l4'])
    expectPartition(next, lines.filter((l) => l.id !== 'l2'))
  })
})

describe('插句：落入锚句所在段', () => {
  it('在段中间插入的新句属于该段，位置紧贴锚句之后', () => {
    const before = makeLines(4)
    const segments = [seg('s1', '甲', ['l1', 'l2']), seg('s2', '乙', ['l3', 'l4'])]
    // 与编辑页一致：lines 也在同一位置插入新句
    const newLine: Line = { id: 'lnew', text: '', cues: [], marks: [] }
    const lines = [...before.slice(0, 2), newLine, ...before.slice(2)]

    const next = normalizeSegments(lines, insertLineIntoSegment(segments, 'l2', 'lnew'))

    expect(next.length).toBe(2)
    expect(next[0].lineIds).toEqual(['l1', 'l2', 'lnew'])
    expect(next[1].lineIds).toEqual(['l3', 'l4'])
    expectPartition(next, lines)
  })

  it('在末句后插入，归入最后一段', () => {
    const before = makeLines(3)
    const segments = [seg('s1', '甲', ['l1', 'l2', 'l3'])]
    const newLine: Line = { id: 'lnew', text: '', cues: [], marks: [] }
    const lines = [...before, newLine]

    const next = normalizeSegments(lines, insertLineIntoSegment(segments, 'l3', 'lnew'))

    expect(next[0].lineIds).toEqual(['l1', 'l2', 'l3', 'lnew'])
    expectPartition(next, lines)
  })
})

describe('剪开：只动被剪的那一段', () => {
  it('从第二段中间剪开：前面的段原样保留，仅被剪段一分为二', () => {
    const lines = makeLines(6)
    const s1 = seg('s1', '坐宫', ['l1', 'l2'])
    const s2 = seg('s2', '过关', ['l3', 'l4', 'l5'], true)
    const s3 = seg('s3', '见娘', ['l6'])

    const next = splitSegmentAtLine([s1, s2, s3], 'l5')

    expect(next.length).toBe(4)
    expect(next[0]).toBe(s1) // 前段对象不动
    expect(next[1]).toMatchObject({ id: 's2', title: '过关', loop: true })
    expect(next[1].lineIds).toEqual(['l3', 'l4'])
    expect(next[2].lineIds).toEqual(['l5'])
    expect(next[2].title).toBe('过关（续）')
    expect(next[2].loop).toBeUndefined()
    expect(next[3]).toBe(s3) // 后段对象不动
    expectPartition(next, lines)
  })

  it('在段首剪不开（无意义），原样返回', () => {
    const segments = [seg('s1', '甲', ['l1', 'l2']), seg('s2', '乙', ['l3'])]
    const next = splitSegmentAtLine(segments, 'l1')
    expect(next).toEqual(segments)
  })

  it('剪完每个句子仍恰好归属一段，顺序不乱', () => {
    const lines = makeLines(5)
    const segments = [seg('s1', '甲', ['l1']), seg('s2', '乙', ['l2', 'l3', 'l4', 'l5'])]
    const next = splitSegmentAtLine(segments, 'l3')
    expect(next.map((s) => s.lineIds)).toEqual([['l1'], ['l2'], ['l3', 'l4', 'l5']])
    expectPartition(next, lines)
  })
})

describe('编辑流程组合：删 → 插 → 剪，段句始终一致', () => {
  it('同一份文稿连续操作，每步后每个句子恰好属于一段', () => {
    let lines = makeLines(6)
    let segments: Segment[] = [seg('s1', '坐宫', ['l1', 'l2']), seg('s2', '过关', ['l3', 'l4']), seg('s3', '见娘', ['l5', 'l6'])]

    // 1) 删掉第二段首句 l3
    lines = lines.filter((l) => l.id !== 'l3')
    segments = normalizeSegments(lines, removeLineFromSegments(segments, 'l3'))
    expect(segments.map((s) => [s.title, s.lineIds])).toEqual([
      ['坐宫', ['l1', 'l2']],
      ['过关', ['l4']],
      ['见娘', ['l5', 'l6']],
    ])
    expectPartition(segments, lines)

    // 2) 在「过关」仅剩的 l4 前补一句（相当于在 l2 后插入，落在两段边界 → 归前段）
    const added: Line = { id: 'lx', text: '补的句', cues: [], marks: [] }
    lines = [...lines.slice(0, 2), added, ...lines.slice(2)]
    segments = normalizeSegments(lines, insertLineIntoSegment(segments, 'l2', 'lx'))
    expectPartition(segments, lines)
    expect(segments.map((s) => s.lineIds)).toEqual([['l1', 'l2', 'lx'], ['l4'], ['l5', 'l6']])

    // 3) 从第三段（见娘 l5/l6）的 l6 处剪开
    segments = normalizeSegments(lines, splitSegmentAtLine(segments, 'l6'))
    expect(segments.map((s) => s.title)).toEqual(['坐宫', '过关', '见娘', '见娘（续）'])
    expectPartition(segments, lines)
  })
})

describe('旧数据归一化修复', () => {
  it('段里残留已删除句子的悬空 id：清除后段头重新落在现存首句', () => {
    const live: Line[] = [
      { id: 'a', text: '现存首句', cues: [], marks: [] },
      { id: 'b', text: '现存次句', cues: [], marks: [] },
    ]
    const corrupted = [seg('s1', '坐宫', ['gone1', 'a', 'gone2'], true), seg('s2', '乙', ['b'])]

    const next = normalizeSegments(live, corrupted)

    expect(next.length).toBe(2)
    expect(next[0]).toMatchObject({ id: 's1', title: '坐宫', loop: true })
    expect(next[0].lineIds).toEqual(['a'])
    expectPartition(next, live)
  })

  it('在段中间插入但没归段的孤儿句：前后同属一段则归该段（打印/跳段不再漏句）', () => {
    const live = makeLines(6)
    // l4 是后来插进第二段中间的（前后 l3、l5 都属 s2），旧版本没把它加进任何段
    const corrupted = [seg('s1', '甲', ['l1', 'l2']), seg('s2', '乙', ['l3', 'l5', 'l6'])]

    const next = normalizeSegments(live, corrupted)

    expect(next.map((s) => s.lineIds)).toEqual([['l1', 'l2'], ['l3', 'l4', 'l5', 'l6']])
    expectPartition(next, live)
  })

  it('孤儿落在两段边界：归前一段（按段尾追加处理）', () => {
    const live = makeLines(5)
    const corrupted = [seg('s1', '甲', ['l1', 'l2']), seg('s2', '乙', ['l4', 'l5'])]

    const next = normalizeSegments(live, corrupted)

    expect(next.map((s) => s.lineIds)).toEqual([['l1', 'l2', 'l3'], ['l4', 'l5']])
    expectPartition(next, live)
  })

  it('文稿开头的孤儿：归第一段', () => {
    const live = makeLines(3)
    const corrupted = [seg('s1', '甲', ['l2', 'l3'])]
    const next = normalizeSegments(live, corrupted)
    expect(next[0].lineIds).toEqual(['l1', 'l2', 'l3'])
    expectPartition(next, live)
  })

  it('旧版「全局剪开」把前几段并进第一个：在信息丢失范围内仍保证每句有段、顺序正确', () => {
    const live = makeLines(4)
    const corrupted = [
      seg('s1', '甲', ['l1', 'l2', 'l3', 'l4']), // 旧 split 把全剧并成两段的极端形态之一
    ]
    const next = normalizeSegments(live, corrupted)
    expectPartition(next, live)
  })

  it('空文稿保留占位空段，不强行造段', () => {
    const placeholder = seg('s0', '第1段', [])
    expect(normalizeSegments([], [placeholder])).toEqual([placeholder])
    expect(normalizeSegments([], [])).toEqual([])
  })

  it('段顺序乱（id 指向后面）会按文稿顺序重排；段内乱序会被纠正', () => {
    const live = makeLines(4)
    const corrupted = [seg('s2', '乙', ['l4', 'l3']), seg('s1', '甲', ['l2', 'l1'])]
    const next = normalizeSegments(live, corrupted)
    expect(next.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(next.map((s) => s.lineIds)).toEqual([['l1', 'l2'], ['l3', 'l4']])
  })
})
