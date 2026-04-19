export interface ForumTag { id: string; name: string; }
export type FetchTags = () => Promise<ForumTag[]>;

export interface TagIndex {
  idFor(name: string): Promise<string>;
  refresh(): void;
}

export function createTagIndex(fetchTags: FetchTags): TagIndex {
  let cache: Map<string, string> | null = null;

  async function load() {
    const tags = await fetchTags();
    cache = new Map(tags.map(t => [t.name, t.id]));
  }

  return {
    async idFor(name) {
      if (!cache) await load();
      const id = cache!.get(name);
      if (!id) throw new Error(`Forum tag '${name}' not configured on the channel`);
      return id;
    },
    refresh() { cache = null; },
  };
}
