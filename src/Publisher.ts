export type Subscriber = (...args: any[]) => void;

class Publisher {
  public subscribers: Map<string, Subscriber[]>;

  constructor () {
    this.subscribers = new Map<string, Subscriber[]>();
  }

  notifySubscribers(event: string, ...args: unknown[]): void {
    const listeners = this.subscribers.get(event) || [];
    listeners.forEach((fn) => {
      fn.apply(undefined, args);
    });
  }

  unsubscribe(event: string, listener: Subscriber): void {
    const listeners = this.subscribers.get(event) || [];
    const newListeners = listeners.filter((fn) => fn !== listener);

    if (newListeners.length === 0) {
      this.subscribers.delete(event);
    } else {
      this.subscribers.set(event, newListeners);
    }
  }

  subscribe(event: string, listener: Subscriber): void {
    const listeners = this.subscribers.get(event) || [];
    this.subscribers.set(event, [...listeners, listener]);
  }
}

export default Publisher;
