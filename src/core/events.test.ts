import { describe, expect, it, vi } from 'vitest';
import { EventLog } from './events';

describe('EventLog', () => {
  it('stores newest events first and caps history', () => {
    const log = new EventLog(3);
    log.push('merge', 'one', 0, 0, 1);
    log.push('supernova', 'two', 0, 0, 2);
    log.push('discovery', 'three', 0, 0, 3);
    log.push('absorb', 'four', 0, 0, 4);
    expect(log.events).toHaveLength(3);
    expect(log.events[0].text).toBe('four');
    expect(log.events[2].text).toBe('two');
  });

  it('suppresses repeats inside a cooldown window', () => {
    const log = new EventLog();
    expect(log.push('absorb', 'a', 0, 0, 1, 'hole-1', 3)).not.toBeNull();
    expect(log.push('absorb', 'b', 0, 0, 2, 'hole-1', 3)).toBeNull();
    expect(log.push('absorb', 'c', 0, 0, 4.5, 'hole-1', 3)).not.toBeNull();
  });

  it('notifies listeners and clears state', () => {
    const log = new EventLog();
    const onChange = vi.fn();
    log.onChange = onChange;
    log.push('merge', 'x', 0, 0, 1, 'x', 5);
    log.clear();
    log.push('merge', 'x', 0, 0, 1.1, 'x', 5);
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(log.events).toHaveLength(1);
  });
});

describe('EventLog after time moves backwards (rewind/undo)', () => {
  it('does not silence a cooldown key until sim time catches up', () => {
    const log = new EventLog();
    expect(log.push('slingshot', 'late', 0, 0, 120, 'slingshot', 6)).not.toBeNull();
    // Rewound to T+10: previously suppressed for ~110 s.
    expect(log.push('slingshot', 'after rewind', 0, 0, 10, 'slingshot', 6)).not.toBeNull();
    expect(log.push('slingshot', 'burst', 0, 0, 11, 'slingshot', 6)).toBeNull();
  });

  it('keeps notifying other listeners when one throws', () => {
    const log = new EventLog();
    const seen: string[] = [];
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    log.subscribe(() => {
      throw new Error('observer failure');
    });
    log.subscribe((e) => seen.push(e.text));
    expect(() => log.push('merge', 'ok', 0, 0, 1)).not.toThrow();
    expect(seen).toEqual(['ok']);
    quiet.mockRestore();
  });
});
