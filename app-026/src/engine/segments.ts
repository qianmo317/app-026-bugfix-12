import type { Line, Script, Segment } from '../types'
import type { ScrollEngine } from './scroller'

export interface SegRange {
  title: string
  start: number
  end: number // 不含
  loop?: boolean
  lineIds: string[]
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

/* ---------- 编辑操作：维护 lines ↔ segments 一致 ---------- */

function genSegId() {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

/**
 * 删行后同步段关系：把该行从所在段移除；段因此被掏空则整段移除。
 * 未受影响的段保持原引用。
 */
export function removeLineFromSegments(segments: Segment[], lineId: string): Segment[] {
  const out: Segment[] = []
  for (const seg of segments) {
    if (!seg.lineIds.includes(lineId)) {
      out.push(seg)
      continue
    }
    const lineIds = seg.lineIds.filter((id) => id !== lineId)
    if (lineIds.length > 0) out.push({ ...seg, lineIds })
  }
  return out
}

/**
 * 新行落段：挂到 anchor 行所在的段、紧跟 anchor 之后。
 * anchor 不在任何段（历史遗留数据）时，沿行序向前找最近的有段行挂到其段末；
 * 前面没有则向后找、插到该段首行之前；全文无段则新建一段。
 * `lines` 用于定位 anchor（插入前的行数组）。
 */
export function insertLineIntoSegments(
  segments: Segment[],
  lines: Line[],
  newLineId: string,
  anchorLineId: string | undefined,
  makeId: () => string = genSegId,
): Segment[] {
  const segOf = (lineId: string) => segments.findIndex((seg) => seg.lineIds.includes(lineId))
  const anchorIdx = lines.findIndex((l) => l.id === anchorLineId)

  let si = -1
  let at = -1
  for (let i = anchorIdx; i >= 0; i--) {
    const k = segOf(lines[i].id)
    if (k >= 0) {
      si = k
      at = segments[k].lineIds.indexOf(lines[i].id) + 1
      break
    }
  }
  if (si < 0) {
    for (let i = anchorIdx + 1; i < lines.length; i++) {
      const k = segOf(lines[i].id)
      if (k >= 0) {
        si = k
        at = segments[k].lineIds.indexOf(lines[i].id)
        break
      }
    }
  }
  if (si < 0) {
    return [...segments, { id: makeId(), title: `第${segments.length + 1}段`, lineIds: [newLineId] }]
  }
  const lineIds = segments[si].lineIds.slice()
  lineIds.splice(at, 0, newLineId)
  const out = segments.slice()
  out[si] = { ...segments[si], lineIds }
  return out
}

/**
 * 在指定行处把所在段剪成两段：前行留在原段（段名/循环等保留），
 * 该行及之后进新段（紧随原段插入，默认名「第N段」可再改）；其余段不动。
 * 行不在任何段、或已是段首行 → 原样返回（不剪）。
 */
export function splitSegmentAtLine(
  segments: Segment[],
  lineId: string,
  makeId: () => string = genSegId,
): Segment[] {
  const si = segments.findIndex((seg) => seg.lineIds.includes(lineId))
  if (si < 0) return segments
  const at = segments[si].lineIds.indexOf(lineId)
  if (at <= 0) return segments // 段首行无需再分
  const seg = segments[si]
  const out = segments.slice()
  out[si] = { ...seg, lineIds: seg.lineIds.slice(0, at) }
  out.splice(si + 1, 0, { id: makeId(), title: `第${si + 2}段`, lineIds: seg.lineIds.slice(at) })
  return out
}
