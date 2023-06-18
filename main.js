async function getContent({ github, repo, owner, path, ref }) {
  const content = await github.rest.repos.getContent({
    owner,
    repo,
    path,
    ref,
  });
  return Buffer.from(content.data.content, "base64").toString();
}

async function getSelectedCode({
  github,
  repo,
  owner,
  path,
  side,
  start_side,
  line,
  start_line,
  diff_hunk,
  head_sha,
  base_sha,
}) {
  // A multi-line comment selecting both removed and added lines
  if (start_side !== null && side !== start_side) {
    return diff_hunk;
  }

  // A single-line or multi-line comment selecting only either removed or added lines
  const ref = side === "LEFT" ? base_sha : head_sha;
  const content = await getContent({ github, repo, owner, path, ref });
  return content
    .split("\n")
    .slice((start_line || line) - 1, line)
    .join("\n");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function chatComplete(fetch, openai_api_key, content) {
  // Chat completions API is highly unstable. Retry up to 3 times.
  let resp;
  const numAttempts = 3;
  for (let [index] of Array(numAttempts).fill().entries()) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openai_api_key}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo-0613",
        messages: [
          {
            role: "user",
            content: content,
          },
        ],
        temperature: 0.0,
      }),
    });

    resp = await response.json();
    if (resp.choices && resp.choices.length > 0) {
      return resp.choices[0].message.content.trim();
    }

    console.log(`Attempt ${index + 1} failed. Retrying...`);
    await sleep(1000);
  }

  throw new Error(JSON.stringify(resp));
}

function makePrompt({ body, code, language }) {
  return `
${body.trim()}

\`\`\`${language}
${code}
\`\`\`
`.trim();
}

module.exports = async ({ github, context, fetch, openai_api_key }) => {
  // https://octokit.github.io/rest.js
  console.log(context);
  const { actor } = context;
  const { repo, owner } = context.repo;
  const { number: pull_number, head, base } = context.payload.pull_request;
  const {
    path,
    line,
    start_line,
    start_side,
    side,
    id: comment_id,
    body: rawBody,
    diff_hunk,
    subject_type,
  } = context.payload.comment;
  const body = rawBody.replace(/^\$ai\s+/, "");

  const { runId: run_id, job } = context;
  const jobs = await github.rest.actions.listJobsForWorkflowRun({
    owner,
    repo,
    run_id,
  });
  const { html_url: jobUrl } = jobs.data.jobs.find(({ name }) => name === job);

  if (actor !== "harupy") {
    await github.rest.pulls.createReviewComment({
      owner,
      repo,
      pull_number,
      body: "Sorry, only @harupy can use this action.",
      in_reply_to: comment_id,
      path,
    });
    return;
  }

  if (subject_type === "file") {
    await github.rest.pulls.createReviewComment({
      owner,
      repo,
      pull_number,
      body: "Sorry, file comments are not supported.",
      in_reply_to: comment_id,
      path,
    });
    return;
  }

  // React to the comment
  await github.rest.reactions.createForPullRequestReviewComment({
    owner,
    repo,
    comment_id,
    content: "rocket",
  });

  const code = await getSelectedCode({
    github,
    repo,
    owner,
    path,
    side,
    start_side,
    line,
    start_line,
    diff_hunk,
    head_sha: head.sha,
    base_sha: base.sha,
  });

  // Get a suggestion
  const language = path.split(".").pop();
  const prompt = makePrompt({ body, code, language });
  let suggestion;
  try {
    suggestion = await chatComplete(fetch, openai_api_key, prompt);
  } catch (e) {
    const body = `Chat completions request failed (error: ${e}). See ${jobUrl} for more details.`;
    await github.rest.pulls.createReviewComment({
      owner,
      repo,
      pull_number,
      body,
      in_reply_to: comment_id,
      path,
    });
  }

  // Construct a reply comment
  const reply = `
@${actor}
${suggestion}

<details><summary>Info</summary>

Job: ${jobUrl}
Prompt:

\`\`\`\`\`markdown
${prompt}
\`\`\`\`\`


</details>
`;

  // Post a reply
  await github.rest.pulls.createReviewComment({
    owner,
    repo,
    pull_number,
    body: reply,
    in_reply_to: comment_id,
    path,
  });
};
