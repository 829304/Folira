import type { Muya } from '../../../muya';
import type { IDiagramState, TState } from '../../../state/types';
import type { IPreviewDiagramPayload } from '../../../ui/previewToolBar';
import { fromEvent } from 'rxjs';
import { CLASS_NAMES, PREVIEW_DOMPURIFY_CONFIG } from '../../../config';
import { sanitize } from '../../../utils';
import { finalizeRenderedDiagram, renderDiagram } from '../../../utils/diagram/render';
import logger from '../../../utils/logger';
import Parent from '../../base/parent';

const debug = logger('diagramPreview:');

// Offscreen but laid out, so renderers that measure their container (Vega sizes
// itself from it) still get a width. `visibility` would not affect layout, but
// the node must be in the document for fonts and measurements to resolve.
function createStagingNode(preview: HTMLElement): HTMLElement {
    const staging = document.createElement('div');
    const width = preview.clientWidth || 800;
    staging.style.cssText = `position:absolute;left:-10000px;top:0;width:${width}px;`;
    document.body.appendChild(staging);

    return staging;
}

class DiagramPreview extends Parent {
    private _code: string;
    private _type: string;
    private _rendered = false;
    private _cancelFinalize: (() => void) | null = null;
    private _request = 0;
    static override blockName = 'diagram-preview';

    static create(muya: Muya, state: IDiagramState) {
        const diagramPreview = new DiagramPreview(muya, state);

        return diagramPreview;
    }

    override get path() {
        debug.warn('You can never call `get path` in diagramPreview');
        return [];
    }

    constructor(muya: Muya, { text, meta }: IDiagramState) {
        super(muya);
        this.tagName = 'div';
        this._code = text;
        this._type = meta.type;
        this.classList = ['mu-diagram-preview'];
        this.attributes = {
            spellcheck: 'false',
            contenteditable: 'false',
        };
        this.createDomNode();
        this._attachDOMEvents();
        this.update();
    }

    override getState(): TState {
        debug.warn('You can never call `getState` in diagramPreview');
        return {} as TState;
    }

    private _attachDOMEvents() {
        const clickObservable = fromEvent(this.domNode!, 'click');
        clickObservable.subscribe(this.clickHandler.bind(this));
    }

    clickHandler(event: Event) {
        event.preventDefault();
        event.stopPropagation();

        if (this.muya.isReadOnly) {
            if (this._rendered) {
                this.muya.eventCenter.emit('preview-diagram', {
                    type: this._type,
                    code: this._code,
                    preview: this.domNode!,
                    label: this.domNode!.getAttribute('aria-label'),
                } satisfies IPreviewDiagramPayload);
            }
            return;
        }

        if (this.parent == null)
            return;

        const cursorBlock = this.parent.firstContentInDescendant();
        cursorBlock?.setCursor(0, 0);
    }

    async update(code = this._code) {
        const { i18n } = this.muya;
        // Renderers load lazily and resolve out of order, so each update takes a
        // ticket: work that finishes after a later update started is discarded
        // instead of painting the preview with stale content.
        const request = ++this._request;
        this._rendered = false;
        if (this._code !== code)
            this._code = code;

        // A previous render may still be waiting for its `<svg>`; it must not
        // describe whatever this one puts in its place.
        this._cancelFinalize?.();
        this._cancelFinalize = null;
        this.domNode!.removeAttribute('role');
        this.domNode!.removeAttribute('aria-label');

        if (code) {
            this.domNode!.innerHTML = i18n.t('Loading...');
            const { mermaidTheme, vegaTheme, plantumlServer, sequenceTheme } = this.muya.options;
            const { _type: type } = this;

            // Render off to the side and move the result in once it is known to
            // be current: drawing straight into the node would let an older
            // render overwrite a newer one while it was still in flight.
            const staging = createStagingNode(this.domNode!);

            try {
                await renderDiagram({
                    target: staging,
                    code,
                    type,
                    mermaidTheme,
                    vegaTheme,
                    plantumlServer,
                    sequenceTheme,
                });
            }
            catch (error) {
                staging.remove();
                if (request !== this._request)
                    return;

                const detail
                    = error instanceof Error ? error.message : String(error);
                debug.error(`render ${type} diagram failed: ${detail}`);
                this.domNode!.innerHTML = `<div class="mu-diagram-error">&lt; ${i18n.t(
                    'Invalid Diagram Code',
                )} &gt;<div class="mu-diagram-error-detail">${sanitize(
                    detail,
                    PREVIEW_DOMPURIFY_CONFIG,
                    true,
                )}</div></div>`;
                return;
            }

            if (request !== this._request) {
                staging.remove();
                return;
            }

            this.domNode!.replaceChildren(...Array.from(staging.childNodes));
            staging.remove();
            this._rendered = true;
            this._cancelFinalize = finalizeRenderedDiagram(this.domNode!, i18n.t('Diagram'));
        }
        else {
            this.domNode!.innerHTML = `<div class="${CLASS_NAMES.MU_EMPTY}">&lt; ${i18n.t(
                'Empty Diagram',
            )} &gt;</div>`;
        }
    }
}

export default DiagramPreview;
