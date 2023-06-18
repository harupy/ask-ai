# Ask AI

Enhance PR reviews by querying AI with your questions.

## Usage

1. Select the lines you want to leave a comment on.
2. Start your review comment with `$ai` (e.g. `$ai rewrite this function list comprehensions`).

## How it works

When triggered, this action queries [the OpenAI's chat completions API](https://platform.openai.com/docs/api-reference/chat) with the following prompt and replies to the comment with the response:

````markdown
{your comment}

```
{selected lines}
```
````

## Example

See [example.yaml](./.github/workflows/example.yaml)
