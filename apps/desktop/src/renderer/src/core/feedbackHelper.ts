export function buildFeedbackUrl(params: {
  baseUrl?: string;
  appVersion?: string;
  platform?: string;
  arch?: string;
}): string {
  const base = params.baseUrl || 'https://github.com/Ofir40050/JaMeet/issues/new';
  const version = params.appVersion || '0.1.0';
  const platform = params.platform || 'darwin';
  const arch = params.arch || 'arm64';

  const diagnosticsText = `App Version: ${version}\nPlatform: ${platform} (${arch})`;

  if (base.startsWith('mailto:')) {
    const subject = encodeURIComponent(`[JaMeet Beta Feedback] v${version} (${platform})`);
    const body = encodeURIComponent(`\n\n---\n${diagnosticsText}\n---`);
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}subject=${subject}&body=${body}`;
  }

  const bodyText = `### Describe the issue or feedback\n\n\n---\n**Diagnostics:**\n- **App Version:** \`${version}\`\n- **Platform:** \`${platform} (${arch})\`\n---\n`;
  const encodedBody = encodeURIComponent(bodyText);
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}body=${encodedBody}`;
}
