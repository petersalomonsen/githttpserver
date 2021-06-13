const modalTemplate = (modalcontent) => `<style>
    :host {
        z-index: 2000;
    }
    .modaldiv {
        margin: auto;
        text-align: center;
        padding: 20px;
        background-color: rgba(0, 0, 0, 0.9);
        border: #4a4 solid 5px;
        color: #4a4;
        font-family: monospace;
        font-size: 20px;
        border-radius: 50px;
        max-width: 80%;
    }
    button, textarea {
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
    pre {
        overflow: auto;
        font-size: 14px;
        color: white;
        background-color: rgba(0,0,0,0.9);
        padding: 20px;
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

            this.shadowRoot.copyToClipboard = (elementId) => {
                var copyText = this.shadowRoot.getElementById(elementId).innerText;
                const textArea = document.createElement('textarea');
                textArea.style.position = 'absolute';
                textArea.style.top = '-500px';
                textArea.textContent = copyText;
                this.shadowRoot.append(textArea);
                textArea.select();
                document.execCommand("copy");
                textArea.remove();
            };
        }
    });

export async function modal(modalContent) {
    const modalElement = document.createElement('common-modal');
    modalElement.style.position = 'fixed';
    modalElement.style.left = '0px';
    modalElement.style.top = '0px';
    modalElement.style.right = '0px';
    modalElement.style.bottom = '0px';
    modalElement.style.display = 'flex';
    modalElement.shadowRoot.innerHTML = modalTemplate(modalContent);
    document.documentElement.appendChild(modalElement);
    const result = await modalElement.resultPromise;
    document.documentElement.removeChild(modalElement);
    return result;
}