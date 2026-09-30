import { test, expect } from '@playwright/test'
import { createScriptViaUI } from './helpers'

const SCRIPT = `## 坐宫
生：A1
生：A2

## 过关
生：B1
生：B2

## 见娘
生：C1
生：C2`

/** 第 idx 行（0 起）行尾的操作按钮 */
function opAt(page: import('@playwright/test').Page, idx: number, title: string) {
  return page.locator(`.line-row[data-idx="${idx}"] .op[title="${title}"]`)
}

test.describe('编辑文稿后唱段与句子始终对得上', () => {
  test.beforeEach(async ({ page }) => {
    await createScriptViaUI(page, '段句同步E2E', SCRIPT)
  })

  test('删掉某段第一句：段名/循环/句数仍在，段数不减少', async ({ page }) => {
    await expect(page.getByTestId('segment-header')).toHaveCount(3)
    // B1 是第 3 行（idx=2）、「过关」首句
    await opAt(page, 2, '删除本行').click()

    // 段头仍是 3 个；「过关」还在，且句数从 2 变 1，首句行仍是它（行号 3，即原 B2）
    await expect(page.getByTestId('segment-header')).toHaveCount(3)
    const headers = page.getByTestId('segment-header')
    await expect(headers.nth(1).locator('.seg-title')).toHaveValue('过关')
    await expect(headers.nth(1)).toContainText('1 句')
  })

  test('段中间插入一句：新句归本段，打印页能打出来', async ({ page }) => {
    await expect(page.getByTestId('line-row')).toHaveCount(6)
    // 在 B1（idx=2）后插入，新行落在「过关」段中间（B1 与 B2 之间）
    await opAt(page, 2, '下一行前插入').click()

    await expect(page.getByTestId('line-row')).toHaveCount(7)
    // 「过关」句数变为 3
    const headers = page.getByTestId('segment-header')
    await expect(headers.nth(1)).toContainText('3 句')
    // 段头仍只有 3 个（新句没有自立空段，也没丢段）
    await expect(page.getByTestId('segment-header')).toHaveCount(3)

    // 等防抖保存落盘后再跳打印页（打印页从 IndexedDB 重新读取）
    await expect(page.getByTestId('save-state')).toHaveText('已保存', { timeout: 6000 })
    // 打印页：3 个段、7 句全部打出来（旧 bug 下孤儿句整行不见）
    await page.getByRole('link', { name: '打印' }).click()
    await page.waitForURL(/\/print\//)
    await expect(page.locator('.print-seg')).toHaveCount(3)
    await expect(page.locator('.print-line')).toHaveCount(7)
    await expect(page.locator('.print-seg').nth(1).locator('h2')).toHaveText('过关')
  })

  test('从第二段中间剪开：只动被剪段，前段不并、段名不变成编号', async ({ page }) => {
    // 在 B2（idx=3，非段首）处剪开「过关」
    await opAt(page, 3, '从此行分为新唱段').click()

    await expect(page.getByTestId('segment-header')).toHaveCount(4)
    const headers = page.getByTestId('segment-header')
    const expectTitles = ['坐宫', '过关', '过关（续）', '见娘']
    for (const [i, t] of expectTitles.entries()) {
      await expect(headers.nth(i).locator('.seg-title')).toHaveValue(t)
    }
    // 句数：坐宫2 / 过关1 / 续1 / 见娘2
    const expectCounts = ['2 句', '1 句', '1 句', '2 句']
    for (const [i, c] of expectCounts.entries()) {
      await expect(headers.nth(i)).toContainText(c)
    }
  })

  test('剪开后排练跳段：新增段可跳，句子不被跳过', async ({ page }) => {
    await opAt(page, 3, '从此行分为新唱段').click()
    await expect(page.getByTestId('segment-header')).toHaveCount(4)
    // 等防抖保存落盘后再跳排练页（排练页从 IndexedDB 重新读取）
    await expect(page.getByTestId('save-state')).toHaveText('已保存', { timeout: 6000 })

    await page.getByRole('link', { name: '排练' }).click()
    await page.waitForURL(/\/prompt\//)
    await expect(page.getByTestId('segment-chip')).toHaveCount(4)
  })
})
