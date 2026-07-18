import { ProviderRepository } from "../repositories";
import { EventBus, defaultEventBus } from "../events/EventBus";

export interface SearchProvider {
  name: string;
  search(query: string): Promise<any>;
}

export class TinyFishProvider implements SearchProvider {
  public name = "TinyFish";

  constructor(private apiKey?: string) {}

  async search(query: string): Promise<any> {
    return {
      provider: "TinyFish",
      query,
      results: [{ title: `TinyFish result for ${query}`, score: 0.95 }],
    };
  }
}

export class TavilyProvider implements SearchProvider {
  public name = "Tavily";

  constructor(private apiKey?: string) {}

  async search(query: string): Promise<any> {
    return {
      provider: "Tavily",
      query,
      results: [{ title: `Tavily result for ${query}`, score: 0.92 }],
    };
  }
}

export class SearchOrchestrator {
  private providers: SearchProvider[] = [];

  constructor(
    private providerRepo: ProviderRepository,
    private eventBus: EventBus = defaultEventBus,
  ) {}

  public registerProvider(provider: SearchProvider): void {
    this.providers.push(provider);
  }

  async search(query: string): Promise<any> {
    if (this.providers.length === 0) {
      throw new Error("[SearchOrchestrator] No search providers registered.");
    }

    for (const provider of this.providers) {
      const startTime = Date.now();
      try {
        const result = await provider.search(query);
        const latency = Date.now() - startTime;
        await this.providerRepo.recordProviderLatency(provider.name, latency);
        return result;
      } catch (err: any) {
        const errorMessage = err?.message || String(err);
        await this.providerRepo.recordProviderFailure(
          provider.name,
          errorMessage,
        );
      }
    }

    throw new Error(
      `[SearchOrchestrator] All search providers failed for query "${query}".`,
    );
  }
}
