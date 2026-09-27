import { vi } from "vitest";

export const requestUrl = vi.fn().mockResolvedValue({
  status: 200,
  text: "",
  arrayBuffer: new ArrayBuffer(0),
  json: {}
});

export class Notice {
  message: string;
  constructor(message: string) {
    this.message = message;
  }
}

export class Modal {
  app: any;
  contentEl: any;
  modalEl: any;

  constructor(app: any) {
    this.app = app;
    this.contentEl = createMockElement();
    this.modalEl = createMockElement();
  }

  open() {}
  close() {}
  onOpen() {}
  onClose() {}
  setDisplayText(_text: string) {}
}

export class ItemView {
  plugin: any;
  containerEl: any;
  leaf: any;

  constructor(leaf: any, plugin?: any) {
    this.leaf = leaf;
    this.plugin = plugin;
    this.containerEl = createMockElement();
  }

  getViewType(): string { return ""; }
  getDisplayText(): string { return ""; }
  getIcon(): string { return ""; }
  async onOpen() {}
  async onClose() {}
  async setState(_state: any, _result: any) {}
  getState(): any { return {}; }
  setDisplayText(_text: string) {}
}

export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl: any;

  constructor(app: any, plugin: any) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = createMockElement();
  }

  display() {}
  hide() {}
}

export class Setting {
  constructor(_containerEl: any) {}
  setName(_name: string) { return this; }
  setDesc(_desc: string) { return this; }
  addText(_cb: any) { return this; }
  addToggle(_cb: any) { return this; }
  addSlider(_cb: any) { return this; }
  addDropdown(_cb: any) { return this; }
}

export class TFile {
  path: string = "";
  name: string = "";
  basename: string = "";
  extension: string = "";
}

export function setIcon(_el: any, _name: string) {}

function createMockElement(): any {
  const el: any = {
    empty: vi.fn(),
    createEl: vi.fn(() => createMockElement()),
    createDiv: vi.fn(() => createMockElement()),
    addClass: vi.fn(),
    removeClass: vi.fn(),
    toggleClass: vi.fn(),
    textContent: "",
    innerHTML: "",
    style: {},
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
      contains: vi.fn(() => false)
    },
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    appendChild: vi.fn(),
    removeChild: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setAttribute: vi.fn(),
    getAttribute: vi.fn(),
    onclick: null,
    onchange: null,
    disabled: false,
    value: "",
    setValue: vi.fn(),
    setText: vi.fn(),
    setPlaceholder: vi.fn(),
    setLimits: vi.fn(() => ({ setValue: vi.fn(() => ({ setDynamicTooltip: vi.fn() })) })),
    addOption: vi.fn(),
    onChange: vi.fn()
  };
  return el;
}
