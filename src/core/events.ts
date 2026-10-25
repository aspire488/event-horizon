import type { CosmicEvent, EventKind } from './types';

export class EventLog {
  readonly events: CosmicEvent[] = [];
  onChange: (() => void) | null = null;
  private nextId = 1;
  private lastKeyAt = new Map<string, number>();

  constructor(private readonly capacity = 60) {}

  /**
   * Records an event. `cooldownKey` suppresses repeats (e.g. one absorption
   * message per black hole every few seconds) so the feed stays meaningful.
   */
  push(
    kind: EventKind,
    text: string,
    x: number,
    y: number,
    at: number,
    cooldownKey?: string,
    cooldown = 2.5,
  ): CosmicEvent | null {
    if (cooldownKey) {
      const last = this.lastKeyAt.get(cooldownKey);
      if (last !== undefined && at - last < cooldown) return null;
      this.lastKeyAt.set(cooldownKey, at);
    }
    const event: CosmicEvent = { id: this.nextId++, at, kind, text, x, y };
    this.events.unshift(event);
    if (this.events.length > this.capacity) this.events.length = this.capacity;
    this.onChange?.();
    return event;
  }

  clear(): void {
    this.events.length = 0;
    this.lastKeyAt.clear();
    this.onChange?.();
  }
}
