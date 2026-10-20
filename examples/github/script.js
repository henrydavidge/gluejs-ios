// GitHub repo check: stars, open issues and PRs, and the latest release, using Octokit from npm
//
// Input: "owner/repo" (default "nodejs/node").
// Optional: add a GITHUB_TOKEN secret in GlueJS's Secrets tab with allowed host api.github.com,
// for private repos and higher rate limits. The script only ever sees a stand-in for the
// token; GlueJS inserts the real value when the request goes to api.github.com.

import { Octokit } from '@octokit/core';

export default async function main(input) {
  const slug = (typeof input === 'string' && input.trim()) || 'nodejs/node';
  const [owner, repo, extra] = slug.trim().split('/');
  if (!owner || !repo || extra !== undefined) throw new Error(`Input should look like "owner/repo", got "${slug}"`);

  const octokit = new Octokit({
    auth: Secrets.has('GITHUB_TOKEN') ? Secrets.get('GITHUB_TOKEN') : undefined,
    userAgent: 'glue-example',
  });

  const { data: info } = await octokit.request('GET /repos/{owner}/{repo}', { owner, repo });
  const { data: pulls } = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
    owner, repo, state: 'open', per_page: 100,
  });
  let release = null;
  try {
    ({ data: release } = await octokit.request('GET /repos/{owner}/{repo}/releases/latest', { owner, repo }));
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  const days = (iso) => Math.round((Date.now() - Date.parse(iso)) / 86_400_000);
  const count = (n) => n.toLocaleString('en-US');
  // GitHub counts open PRs as issues too.
  const openPRs = pulls.length === 100 ? '100+' : String(pulls.length);
  const openIssues = Math.max(0, info.open_issues_count - pulls.length);
  // Only the first page of PRs was fetched; subtraction is an upper bound when full.
  const issueCount = pulls.length === 100 ? `at most ${count(openIssues)}` : count(openIssues);
  console.log(`Authenticated: ${Secrets.has('GITHUB_TOKEN')}`);

  return [
    `${info.full_name}: ★ ${count(info.stargazers_count)}, ${count(info.forks_count)} forks`,
    `Open: ${issueCount} issues, ${openPRs} pull requests`,
    `Last push: ${days(info.pushed_at)} day(s) ago`,
    release ? `Latest release: ${release.tag_name}, ${days(release.published_at)} day(s) ago` : 'No releases yet',
  ].join('\n');
}
