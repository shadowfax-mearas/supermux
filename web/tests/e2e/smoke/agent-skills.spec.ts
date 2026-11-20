import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { injectGlobals, startBackend } from './harness'

test('manage a scoped skill and edit nested Markdown in the Store', async ({
  page,
}, info) => {
  const backend = await startBackend()
  try {
    const installed = join(backend.claudeConfigDir, 'skills', 'release-review')
    await mkdir(join(installed, 'assets'), { recursive: true })
    await writeFile(
      join(installed, 'SKILL.md'),
      '---\nname: release-review\ndescription: Prepare a release\n---\n',
    )
    await writeFile(
      join(installed, 'assets', 'example.bin'),
      Buffer.from([0, 255, 17]),
    )
    await page.addInitScript(injectGlobals(backend.token))
    await page.goto(backend.baseUrl + '/store')
    await expect(
      page.getByRole('link', { name: 'Agent skills', exact: true }),
    ).toBeVisible()
    await page.screenshot({ path: info.outputPath('connectors.png') })
    await page.getByRole('link', { name: 'Agent skills', exact: true }).click()
    await page.getByRole('button', { name: 'Add skill', exact: true }).click()
    await page
      .getByLabel('Import from this server')
      .selectOption({ label: 'release-review · Claude · user' })
    await expect(page.getByLabel('Skill name')).toHaveValue('release-review')
    const manifest =
      '---\nname: release-review\ndescription: Review a release before shipping.\n---\n\nSee references/checklist.md.'
    await page.getByLabel('Markdown content').fill(manifest)
    await page.getByLabel('New Markdown path').fill('references/checklist.md')
    await page.getByRole('button', { name: 'Add file' }).click()
    await page.getByLabel('Markdown content').fill('Verify the changelog.')
    await page.getByRole('button', { name: 'Save skill' }).click()
    await page.getByRole('button', { name: 'Grant', exact: true }).click()
    await expect(page.getByText('Granted via All agents')).toBeVisible()
    await page.screenshot({ path: info.outputPath('library.png') })
    await page.getByRole('button', { name: 'Edit files' }).click()
    await expect(page.getByLabel('Markdown content')).toHaveValue(manifest)
    await page
      .getByLabel('Markdown file', { exact: true })
      .selectOption('references/checklist.md')
    await expect(page.getByLabel('Markdown content')).toHaveValue(
      'Verify the changelog.',
    )
    await page
      .getByLabel('Markdown content')
      .fill('Verify the changelog and run the release tests.')
    await page.screenshot({ path: info.outputPath('editor.png') })
    await page.getByRole('button', { name: 'Save skill' }).click()
    const details = await page.request.get(
      backend.backendUrl + '/api/agent-skills/release-review',
      { headers: { Authorization: 'Bearer ' + backend.token } },
    )
    expect((await details.json()).files['assets/example.bin']).toBe(
      Buffer.from([0, 255, 17]).toString('base64'),
    )
    await page.reload()
    await page.getByRole('button', { name: 'Edit files' }).click()
    await page
      .getByLabel('Markdown file', { exact: true })
      .selectOption('references/checklist.md')
    await expect(page.getByLabel('Markdown content')).toHaveValue(
      'Verify the changelog and run the release tests.',
    )
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: 'Disable grant' }).click()
    await expect(page.getByText('Grant disabled')).toBeVisible()
    await page.getByRole('button', { name: 'Revoke', exact: true }).click()
    await expect(page.getByText('Available to grant')).toBeVisible()
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Uninstall' }).click()
    await expect(page.getByText('No skills installed.')).toBeVisible()
  } finally {
    await backend.dispose()
  }
})
