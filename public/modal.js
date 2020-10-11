export const modalTemplate = (modalcontent) => `<style>
    .modaldiv {
        z-index: 10000;
        position: fixed;
        top:20px;
        bottom: 20px;
        left: 0;
        right: 0;
        height: auto;
        max-width: 500px;
        
        margin: auto;
        overflow: auto;
        
        padding: 20px;
        background-color: rgba(0, 0, 0, 0.9);
        border: #4a4 solid 5px;
        color: #4a4;
        font-family: monospace;
        font-size: 20px;
        border-radius: 50px;
    }
    button, textarea, input {
        font-family: monospace;
        background-color: #cfc;
        border-color: #4a4;
        border-width: 1px;
        color:#050;
        padding: 10px;
        font-size: 20px;
        
        border-radius: 4px;
        white-space: nowrap;
        
        margin: 2px;
        user-select: none;
    }
    textarea {
        width: 80%;
        height: 80px;
    }
</style>
<div class="modaldiv">
    ${modalcontent}
</div>`;

customElements.define('common-modal',
    class extends HTMLElement {
        constructor() {
            super();

            this.attachShadow({ mode: 'open' });
            this.resultPromise = new Promise(resolve => this.shadowRoot.result = resolve);
        }
    });

export async function modal(modalContent) {
    const modalElement = document.createElement('common-modal');
    modalElement.shadowRoot.innerHTML = modalTemplate(modalContent);
    document.documentElement.appendChild(modalElement);
    const result = await modalElement.resultPromise;
    document.documentElement.removeChild(modalElement);
    return result;
}