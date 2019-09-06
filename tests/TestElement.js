import _ from '../AutomatonElement.js';

export default class TestElement extends _('html'){
	constructor(){
		super({
			message: "Hello World"
		})
	}
}
window.customElements.define("ui-testelement", TestElement);