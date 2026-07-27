export function makeSnippets(prefix: string) {
  return {
    noLogin:
      `you haven't registered your Last.fm user account to this bot! ` +
      `Please do so with \`${prefix}login <lastfm username>\` to be able to use this command!`,
    error: `There was an error trying to execute the command. Please try again later.`,
    notPlaying: `currently, you're not listening to anything.`,
  } as const;
}

export type Snippets = ReturnType<typeof makeSnippets>;
