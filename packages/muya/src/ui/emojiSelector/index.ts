import type { VNode } from 'snabbdom';
import type { Emoji as EmojiType } from '../../config/emojis';
import type { Muya } from '../../index';

import { query } from '../../utils/dom';
import { h, patch } from '../../utils/snabbdom';
import BaseScrollFloat from '../baseScrollFloat';
import Emoji, { prefetchEmojis } from './emoji';
import './index.css';

const defaultOptions = {
    placement: 'bottom' as const,
    offsetOptions: {
        mainAxis: 12,
        crossAxis: 0,
        alignmentAxis: 0,
    },
    showArrow: false,
};

export class EmojiSelector extends BaseScrollFloat {
    static pluginName = 'emojiPicker';
    public override capturesContentKeydown = true;
    private _renderObj: Record<string, EmojiType[]> | null = null;
    private _oldVNode: VNode | null = null;
    private _emoji: Emoji = new Emoji();
    /**
     * Bumped for every look-up, and whenever the picker is hidden from the
     * outside; a look-up that finishes loading after either one is dropped.
     */
    private _searchToken = 0;
    /**
     * True while `searchAndShow` runs, so its own `hide()` — the empty result
     * before the table lands — does not count as the user closing the picker.
     */
    private _searching = false;
    public override renderArray: EmojiType[] = [];
    public override activeItem: EmojiType | null = null;

    constructor(muya: Muya) {
        const name = 'mu-emoji-picker';
        super(muya, name, defaultOptions);

        this.listen();
        prefetchEmojis();
    }

    get renderObj(): Record<string, EmojiType[]> {
        return this._renderObj || {};
    }

    set renderObj(obj: Record<string, EmojiType[]>) {
        this._renderObj = obj;
        const renderArray: EmojiType[] = [];
        Object.keys(obj).forEach((key) => {
            renderArray.push(...obj[key]);
        });
        this.renderArray = renderArray;
        if (this.renderArray.length > 0) {
            this.activeItem = this.renderArray[0];
            const activeEle = this.getItemElement(this.activeItem);
            if (activeEle)
                this.activeEleScrollIntoView(activeEle);
        }
    }

    override hide() {
        if (!this._searching)
            this._searchToken++;

        super.hide();
    }

    override listen() {
        super.listen();
        const { eventCenter } = this.muya;
        eventCenter.on('muya-emoji-picker', ({ reference, emojiText, block }) => {
            if (!emojiText)
                return this.hide();
            const text = emojiText.trim();
            if (text) {
                const token = ++this._searchToken;
                const cb: (item: EmojiType) => void = (item) => {
                    if (block && block.setEmoji)
                        block.setEmoji(item.aliases[0]);
                };
                const searchAndShow = (): void => {
                    this._searching = true;
                    try {
                        this.renderObj = this._emoji.search(text);
                        if (this.renderArray.length) {
                            this.show(reference, cb);
                            this.render();
                        }
                        else {
                            this.hide();
                        }
                    }
                    finally {
                        this._searching = false;
                    }
                };

                searchAndShow();
                // The emoji table loads on demand, so the first `:` typed in a
                // session searches an empty one. Search again once it lands —
                // `whenReady` is already resolved on every later keystroke, so
                // this costs a microtask and nothing else. Skipped when another
                // look-up started, or the picker was closed, in the meantime:
                // otherwise the table landing re-opens a picker the user shut.
                void this._emoji.whenReady().then(() => {
                    if (token === this._searchToken)
                        searchAndShow();
                });
            }
        });
    }

    render() {
        const { scrollElement, renderObj, activeItem, _oldVNode: oldVNode } = this;
        const { i18n } = this.muya;

        const children = Object.keys(renderObj).map((category) => {
            const title = h('div.title', i18n.t(category) || category);
            const emojis = renderObj[category].map((e: EmojiType) => {
                const selector = activeItem === e ? 'div.item.active' : 'div.item';

                return h(
                    selector,
                    {
                        dataset: { label: e.aliases[0] },
                        props: { title: e.description },
                        on: {
                            click: () => {
                                this.selectItem(e);
                            },
                        },
                    },
                    h('span', e.emoji),
                );
            });

            return h('section', [title, h('div.emoji-wrapper', emojis)]);
        });

        const vnode = h('div', children);

        if (oldVNode)
            patch(oldVNode, vnode);
        else
            patch(scrollElement!, vnode);

        this._oldVNode = vnode;
    }

    getItemElement(item: EmojiType) {
        const label = item.aliases[0];

        return query<HTMLElement>(`[data-label="${label}"]`, this.floatBox!);
    }

    override destroy() {
        super.destroy();
        this._emoji.destroy();
    }
}
