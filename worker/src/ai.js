// JourneyMan bridge — the Claude features (phase 5).
// Each feature is its own route with its own prompt and JSON schema, so the bridge can't be used
// as a general-purpose Claude proxy. Answers are constrained to the schema with structured outputs.

import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-opus-5-5';

const str = (description) => ({ type: 'string', description });
const int = (description) => ({ type: 'integer', description });
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

const SYSTEM = `You help one person run JourneyMan, their personal task list and time tracker, organised by PARA:
areas (ongoing parts of life), projects (goals with an end), and tasks (concrete next actions).
Write tasks as short imperative next actions a person can start right away ("Draft section 2 outline", not "Section 2").
Use plain, warm, direct language. Never invent facts about the person's life beyond what you are given.`;

/* The features. `effort` is low for quick picks and extraction, medium for writing and planning. */
export const TASKS = {
  // Brain dump → tasks
  plan: {
    effort: 'low',
    schema: obj({
      tasks: {
        type: 'array',
        items: obj({
          title: str('A short imperative next action'),
          project: str('Name of an existing project it belongs to, a short new project name if several tasks clearly share one, or empty'),
          area: str('Name of an existing area, only when there is no project; otherwise empty'),
          when: str('Day to do it as YYYY-MM-DD if the text says when, otherwise empty'),
          deadline: str('Hard deadline as YYYY-MM-DD if the text says one, otherwise empty'),
          estimate_minutes: int('Realistic estimate in minutes, 0 if unclear'),
          priority: int('0 normal, 1 important, 2 very important, 3 urgent and important'),
          notes: str('Useful detail from the text that does not fit the title, otherwise empty'),
        }),
      },
    }),
    prompt: (i) => `Today is ${i.today} (${i.weekday}).
Existing areas: ${list(i.areas)}
Existing projects: ${list(i.projects)}

Turn this brain dump into separate tasks. Split combined items, drop filler, keep the person's wording where it is clear.
Resolve relative dates ("Friday", "next week", "tomorrow") against today. Prefer existing project and area names, spelled exactly.

<brain_dump>
${clip(i.text, 8000)}
</brain_dump>`,
  },

  // A project → its first next steps
  breakdown: {
    effort: 'medium',
    schema: obj({
      steps: {
        type: 'array',
        items: obj({
          title: str('A concrete next action'),
          estimate_minutes: int('Realistic estimate in minutes'),
          notes: str('One short line on what done looks like, or empty'),
        }),
      },
    }),
    prompt: (i) => `Today is ${i.today}. Suggest 3 to 7 next steps for this project, in the order to do them.
Don't repeat tasks that already exist. Keep each step small enough to finish in one sitting (under 2 hours).

Project: ${clip(i.project, 200)}
${i.area ? `Area: ${clip(i.area, 100)}\n` : ''}${i.deadline ? `Deadline: ${i.deadline}\n` : ''}${i.notes ? `Notes: ${clip(i.notes, 2000)}\n` : ''}Open tasks: ${list(i.open)}
Finished tasks: ${list(i.done)}`,
  },

  // What should I do now?
  now: {
    effort: 'low',
    schema: obj({
      task_id: str('The id of the chosen candidate, copied exactly'),
      reason: str('One or two sentences on why this one, now'),
      first_step: str('The very first physical action to start it, under 15 words'),
    }),
    prompt: (i) => `It is ${i.time} on ${i.weekday}. I have about ${i.minutes} minutes and my energy is ${i.energy}.
Pick the single best task for right now from these candidates (ranked by deadlines, priority and fit; you may choose differently when energy or time suggests it).

${(i.candidates || []).slice(0, 15).map((c) => `- id ${c.id}: ${clip(c.title, 160)}${c.project ? ` [${clip(c.project, 80)}]` : ''}${c.estimate ? `, about ${c.estimate} min` : ''}${c.deadline ? `, due ${c.deadline}` : ''}${c.reasons ? ` (${clip(c.reasons, 160)})` : ''}`).join('\n')}`,
  },

  // Day journal
  journal: {
    effort: 'medium',
    schema: obj({ entry: str('The journal entry, 80 to 160 words, first person, plain paragraphs separated by blank lines') }),
    prompt: (i) => `Write my journal entry for ${i.day} from these facts. First person, honest and specific: what I did, what moved,
what didn't, and one thing to carry into tomorrow. Use only these facts and my notes; don't add events.

<facts>
${clip(i.facts, 4000)}
</facts>
${i.notes ? `<my_notes>\n${clip(i.notes, 2000)}\n</my_notes>` : ''}`,
  },

  // Weekly review reflection
  review: {
    effort: 'medium',
    schema: obj({
      reflection: str('Three to five sentences reflecting on the week, first person'),
      focus: { type: 'array', items: str('One concrete focus for next week'), description: 'Two or three focuses' },
    }),
    prompt: (i) => `Help me reflect on my week for my weekly review. Use only these facts. Be specific and kind, and name one pattern worth changing.

<week>
${clip(i.summary, 4000)}
</week>
${i.notes ? `<my_notes>\n${clip(i.notes, 2000)}\n</my_notes>` : ''}`,
  },
};

const clip = (s, n) => String(s ?? '').slice(0, n);
const list = (a) => (Array.isArray(a) && a.length ? a.slice(0, 60).map((x) => clip(x, 120)).join('; ') : 'none');

/* POST /ai/<task> with the task's input as JSON → { ok, data, model } or { error }. */
export async function handleAi(task, request, env, headers, { makeClient } = {}) {
  const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const spec = TASKS[task];
  if (!spec) return json({ error: 'Unknown AI feature.' }, 404);
  let input;
  try { input = await request.json(); } catch { return json({ error: 'Send JSON.' }, 400); }

  const client = makeClient ? makeClient(env) : new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
  try {
    const res = await client.beta.messages.create({
      model: env.CLAUDE_MODEL || MODEL,
      max_tokens: 16000,
      // If a safety classifier declines, the API re-runs the request on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: spec.effort, format: { type: 'json_schema', schema: spec.schema } },
      system: SYSTEM,
      messages: [{ role: 'user', content: spec.prompt(input) }],
    });
    if (res.stop_reason === 'refusal') {
      return json({ error: 'Claude declined to help with this one.', category: res.stop_details?.category ?? null }, 422);
    }
    if (res.stop_reason === 'max_tokens') return json({ error: 'The answer was cut off. Try with less text.' }, 502);
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let data;
    try { data = JSON.parse(text); } catch { return json({ error: 'Claude’s answer could not be read.' }, 502); }
    return json({ ok: true, data, model: res.model }, 200);
  } catch (err) {
    // Most specific first. The SDK already retried 429s and server errors twice.
    if (err instanceof Anthropic.AuthenticationError) return json({ error: 'The bridge’s ANTHROPIC_API_KEY was rejected.' }, 502);
    if (err instanceof Anthropic.PermissionDeniedError) return json({ error: 'This API key can’t use that model.' }, 502);
    if (err instanceof Anthropic.RateLimitError) return json({ error: 'Claude is busy right now. Try again in a minute.' }, 429);
    if (err instanceof Anthropic.BadRequestError) return json({ error: `Claude rejected the request: ${err.message}` }, 400);
    if (err instanceof Anthropic.APIConnectionError) return json({ error: 'Couldn’t reach Claude. Try again.' }, 504);
    if (err instanceof Anthropic.APIError) return json({ error: `Claude error ${err.status ?? ''}`.trim() }, 502);
    return json({ error: 'Something went wrong on the bridge.' }, 500);
  }
}
