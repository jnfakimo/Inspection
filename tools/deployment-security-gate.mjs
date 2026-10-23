import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export const requiredWorkflows = ['ci.yml', 'codeql.yml', 'commercial-readiness.yml'];

// 只接受本倉庫 main、同一 SHA 的最新執行；PR、其他分支及較舊成功不能代替。
export async function inspectGate({ get, repository, sha }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error('倉庫或 commit 格式不正確');
  }
  const prefix = `/repos/${repository}`;
  const tip = await get(`${prefix}/git/ref/heads/main`);
  if (tip.object?.sha !== sha) throw new Error('待發布版本已不是 main 最新 commit');
  const checks = await Promise.all(requiredWorkflows.map(async file => {
    const data = await get(`${prefix}/actions/workflows/${file}/runs?branch=main&head_sha=${sha}&per_page=100`);
    if (!Array.isArray(data.workflow_runs)) throw new Error(`${file} 回應不完整`);
    const runs = data.workflow_runs.filter(run =>
      run.head_sha === sha && run.head_branch === 'main'
      && run.head_repository?.full_name === repository
      && run.path === `.github/workflows/${file}`
      && ['push', 'workflow_dispatch', 'schedule'].includes(run.event));
    const latest = runs.sort((a, b) => b.id - a.id)[0];
    if (!latest || latest.status !== 'completed') return { file, ready: false };
    if (latest.conclusion !== 'success') throw new Error(`${file} 未通過：${latest.conclusion || 'unknown'}`);
    return { file, ready: true };
  }));
  // 查詢期間 main 可能移動，再讀一次，避免舊版本覆蓋新版本。
  const finalTip = await get(`${prefix}/git/ref/heads/main`);
  if (finalTip.object?.sha !== sha) throw new Error('檢查期間 main 已更新');
  return { ready: checks.every(check => check.ready), checks };
}

export async function main() {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repository, GITHUB_SHA: sha, GITHUB_REF: ref } = process.env;
  if (!token || ref !== 'refs/heads/main') throw new Error('僅允許 main 發布，且必須提供查詢權限');
  const get = async path => {
    const response = await fetch(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`查核 GitHub 狀態失敗（HTTP ${response.status}）`);
    return response.json();
  };
  const deadline = Date.now() + (process.argv.includes('--once') ? 0 : 18 * 60_000);
  do {
    const result = await inspectGate({ get, repository, sha });
    if (result.ready) {
      console.log(`發布前安全檢查通過：${sha}`);
      return;
    }
    console.log(`等待安全檢查：${result.checks.filter(check => !check.ready).map(check => check.file).join(', ')}`);
    if (Date.now() >= deadline) break;
    await sleep(15_000);
  } while (Date.now() <= deadline);
  throw new Error('必要檢查尚未全部成功，停止發布');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
