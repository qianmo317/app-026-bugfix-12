import type { Line, Script, Segment } from '../types'
import type { ScrollEngine } from './scroller'

export interface SegRange {
  title: string
  start: number
  end: number // 不含
  loop?: boolean
  lineIds: string[]
}

function newSegmentId() {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/**
 * 重整段/句归属，保证不变量：
 * - 每个句子恰好属于一个段，且 id 必须存在于 lines
 * - 段内句子按文稿顺序排列，段顺序与文稿一致
 * - 有句子时没有空段；没有任何段时全篇归为一段
 * - lines 为空时保留现有占位空段（仅清洗其 id），一个段都没有则返回 []
 *
 * 用于加载旧文稿时修复悬空 id / 孤儿句 / 段顺序错乱。
 */
export function normalizeSegments(lines: Line[], segments: readonly Segment[]): Segment[] {
  if (lines.length === 0) {
    // 空文稿：只清悬空/重复 id，保留占位空段（解析空输入时会生成一个）
    if (segments.length === 0) return []
    const seen = new Set<string>()
    return segments
      .map((seg) => ({ ...seg, lineIds: seg.lineIds.filter((id) => {
        if (seen.has(id)) return false
        seen.add(id)
        return true
      }) }))
  }
  const pos = new Map(lines.map((l, i) => [l.id, i] as const))

  // 清洗：丢悬空/重复 id，丢空段；同一句只归属最早声明它的段
  const cleaned: Segment[] = []
  const seen = new Set<string>()
  for (const seg of segments) {
    const lineIds: string[] = []
    for (const id of seg.lineIds) {
      if (!pos.has(id) || seen.has(id)) continue
      seen.add(id)
      lineIds.push(id)
    }
    if (lineIds.length) cleaned.push({ ...seg, lineIds })
  }
  for (const seg of cleaned) seg.lineIds.sort((a, b) => pos.get(a)! - pos.get(b)!)
  cleaned.sort((a, b) => pos.get(a.lineIds[0])! - pos.get(b.lineIds[0])!)

  // owner 在段排序之后建立，否则索引会与排序结果错位
  const owner = new Map<string, number>()
  cleaned.forEach((seg, si) => {
    for (const id of seg.lineIds) owner.set(id, si)
  })

  // 每个位置上、下一个「本来就有段」的句子归属（跳过其它孤儿），
  // 用来判断孤儿是夹在同一段中间，还是落在两段的边界
  const prevOwner: (number | undefined)[] = new Array(lines.length)
  const nextOwner: (number | undefined)[] = new Array(lines.length)
  let seenPrev: number | undefined
  for (let i = 0; i < lines.length; i++) {
    prevOwner[i] = seenPrev
    if (owner.has(lines[i].id)) seenPrev = owner.get(lines[i].id)
  }
  let seenNext: number | undefined
  for (let i = lines.length - 1; i >= 0; i--) {
    nextOwner[i] = seenNext
    if (owner.has(lines[i].id)) seenNext = owner.get(lines[i].id)
  }

  const attach = (id: string, si: number) => {
    cleaned[si].lineIds.push(id)
    owner.set(id, si)
  }

  // 无段归属的句子：夹在同一段中间则归该段；落在段边界则归前一段（段尾追加）
  for (let i = 0; i < lines.length; i++) {
    const id = lines[i].id
    if (owner.has(id)) continue
    const pv = prevOwner[i]
    const nx = nextOwner[i]
    let target = pv !== undefined && pv === nx ? pv : pv ?? nx
    if (target === undefined) {
      cleaned.push({ id: newSegmentId(), title: '第1段', lineIds: [] })
      target = cleaned.length - 1
    }
    attach(id, target)
  }
  for (const seg of cleaned) seg.lineIds.sort((a, b) => pos.get(a)! - pos.get(b)!)
  return cleaned
}

/** 删句：从句属段的 lineIds 中移除；段被删空则整段消失（标题/循环随之一并删除） */
export function removeLineFromSegments(segments: readonly Segment[], lineId: string): Segment[] {
  return segments
    .map((seg) =>
      seg.lineIds.includes(lineId) ? { ...seg, lineIds: seg.lineIds.filter((id) => id !== lineId) } : seg,
    )
    .filter((seg) => seg.lineIds.length > 0)
}

/** 在锚句所属段内、紧贴锚句之后插入新句；锚句无段归属时原样返回（由 normalizeSegments 兜底） */
export function insertLineIntoSegment(segments: readonly Segment[], anchorId: string, newId: string): Segment[] {
  const si = segments.findIndex((seg) => seg.lineIds.includes(anchorId))
  if (si === -1) return segments.slice()
  const lineIds = segments[si].lineIds.slice()
  lineIds.splice(lineIds.indexOf(anchorId) + 1, 0, newId)
  const out = segments.slice()
  out[si] = { ...out[si], lineIds }
  return out
}

/**
 * 从某句处把所属段一分为二：该句起为新段，前半留在原段（保留标题与循环勾选）。
 * 只动被剪的那一段，其它段不变。该句已是段首时无需剪开，原样返回。
 */
export function splitSegmentAtLine(segments: readonly Segment[], lineId: string): Segment[] {
  const si = segments.findIndex((seg) => seg.lineIds.includes(lineId))
  if (si === -1) return segments.slice()
  const seg = segments[si]
  const at = seg.lineIds.indexOf(lineId)
  if (at <= 0) return segments.slice()
  const head: Segment = { ...seg, lineIds: seg.lineIds.slice(0, at) }
  const tail: Segment = { id: newSegmentId(), title: `${seg.title}（续）`, lineIds: seg.lineIds.slice(at) }
  const out = segments.slice()
  out.splice(si, 1, head, tail)
  return out
}

/** 结构比较：加载归一化后判断旧数据是否真的被改动（避免完好数据触发多余保存） */
export function segmentsDiffer(a: readonly Segment[], b: readonly Segment[]): boolean {
  if (a.length !== b.length) return true
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.id !== y.id || x.title !== y.title || !!x.loop !== !!y.loop) return true
    if (x.lineIds.length !== y.lineIds.length) return true
    for (let j = 0; j < x.lineIds.length; j++) {
      if (x.lineIds[j] !== y.lineIds[j]) return true
    }
  }
  return false
}

/** 计算各唱段在行数组（或按角色过滤后的行数组）中的起止范围 */
export function segmentRanges(script: Script, filter?: (idx: number) => boolean): SegRange[] {
  const indexOfLine = new Map(script.lines.map((l, i) => [l.id, i] as const))
  const out: SegRange[] = []
  for (const seg of script.segments) {
    const idxs = seg.lineIds
      .map((id) => indexOfLine.get(id))
      .filter((v): v is number => v !== undefined)
      .filter((i) => (filter ? filter(i) : true))
    if (idxs.length === 0) continue
    const sorted = filter ? idxs.slice().sort((a, b) => a - b) : idxs
    out.push({ title: seg.title, start: sorted[0], end: sorted[sorted.length - 1] + 1, loop: seg.loop, lineIds: seg.lineIds })
  }
  if (!filter && out.length === 0 && script.lines.length > 0) {
    out.push({ title: '全篇', start: 0, end: script.lines.length, lineIds: script.lines.map((l) => l.id) })
  }
  return out
}

/** 跳转到第 k 段（保持播放状态），自动应用该段的循环标记 */
export function jumpToSegment(engine: ScrollEngine, ranges: SegRange[], k: number): boolean {
  if (!ranges.length) return false
  const kk = Math.max(0, Math.min(ranges.length - 1, k))
  const wasPlaying = engine.state === 'playing'
  engine.seekIndex(ranges[kk].start)
  if (wasPlaying) engine.play()
  const r = ranges[kk]
  engine.setLoopRange(r.loop ? { startPos: engine.posForIndex(r.start), endPos: engine.posForIndex(r.end) } : null)
  return true
}
