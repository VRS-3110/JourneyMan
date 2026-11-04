// JourneyMan — calls the Claude features on your bridge (worker/src/ai.js). No keys here: the bridge holds them.

export async function callAi({ workerUrl, appKey }, feature, input, fetchImpl = globalThis.fetch) {
  const base = String(workerUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('Set up your bridge in Connections first.');
  let res;
  try {
    res = await fetchImpl(`${base}/ai/${feature}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${appKey || ''}` },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error('Couldn’t reach your bridge. Are you online?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `The bridge answered ${res.status}`);
  return data.data;
}
