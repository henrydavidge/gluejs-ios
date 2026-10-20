// New release watcher: says whether a GitHub repo has published a release since the last check
//
// Input: "owner/repo". Remembers the last release it saw in the Store, so a daily automation
// can tell you only what's new. Uses GitHub's public API (no token needed for public repos).

interface Release {
  tag_name: string;
  html_url: string;
}

export default async function main(input: unknown): Promise<string> {
  const repo = String(input ?? '').trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`Input should look like "owner/repo", got "${repo}"`);

  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'gluejs-example' },
  });
  if (response.status === 404) return `${repo} has no releases yet.`;
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
  const release = (await response.json()) as Release;

  const key = `release-watch:${repo}`;
  const seen = Store.get<string>(key);
  Store.set(key, release.tag_name);

  if (seen === undefined) return `Now watching ${repo}. Latest release: ${release.tag_name}.`;
  if (seen === release.tag_name) return `No new release of ${repo} (still ${release.tag_name}).`;
  return `New release of ${repo}: ${release.tag_name} (was ${seen}). ${release.html_url}`;
}
