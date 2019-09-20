// used to prevent having to rebuild the class chain every component instance
const CHAINED_CLASS_CACHE = {};
const EXTENTION_REGISTRY = {};

let _ = (...classes)=>{
	let classKey = classes.join("|");
	if(CHAINED_CLASS_CACHE[classKey]!=null) {
		return CHAINED_CLASS_CACHE[classKey];
	}

	let c = BasicComponent;
	for(let clas of classes){
		c = EXTENTION_REGISTRY[clas](c);	
	}
	CHAINED_CLASS_CACHE[classKey] = c;

	c.EXTENSION_DEPTH = classes.length;

	return c;
};

_.registerExtension = (name, classFunction)=>{
	EXTENTION_REGISTRY[name] = classFunction;
}

export default _;

// used to add the UUID to elements
let UUID = 0;

//TODO formalize struture and add 'types'
const bindPrefix = "_";
let BIND_ATTRIBUTES = {};

// _for="item:$items"
BIND_ATTRIBUTES[bindPrefix+"for"] = "for"; // for LOOOPs

BIND_ATTRIBUTES[bindPrefix] = "value";

BIND_ATTRIBUTES[bindPrefix+"debugger"] = "debugger";
BIND_ATTRIBUTES[bindPrefix+"body"] = "innerHTML";
BIND_ATTRIBUTES[bindPrefix+"show"] = "show"; // show
BIND_ATTRIBUTES[bindPrefix+"data"] = "data-data";
for(let attr of ["selected", "value", "min", "max", "innerHTML", "onclick", "style", "src"]){
	BIND_ATTRIBUTES[bindPrefix+attr] = attr;
}

const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

class BasicComponent extends HTMLElement{

	#attached = false;
	_bindings = {};
	#ready = false;

	#setupQueue = [];

	constructor(data={}, flags = {}){
		super();
		
		// resolve this classes file path for relative file resolution
		if(this.baseUrl==null){
			let parts = (new Error()).stack.split('\n');
			let path = parts[2+ this.constructor.EXTENSION_DEPTH];
			path = path.substring(path.indexOf('(')+1);
			path = path.substring(0,path.indexOf(".js:"))+".js";
			this.static.baseUrl = path;
		}

		this.id = "ui_"+UUID++;

		this.bindingID = 0;

		let reservedFunctions = ["connectedCallback", "disconnectedCallback"];
		reservedFunctions.forEach((func)=>{
			if(new.target.prototype[func] != BasicComponent.prototype[func]){
				console.warn(`${new.target.name} overrides ${func}, this is a very bad idea`);
			}
		});

		if(flags.json){
			this.jsonData = data;
		}else{
			this.setData(data);
		}

		this.dataListener = {};

		this.load();

		Promise.all(this.#setupQueue).then(async ()=>{
			this.innerHTML = this.markup();
			this.bind();
			await this.init();
			this.dataChange();

			this.#ready = true;
		});
	}

	get static(){
		if(this.constructor.static==null){
			this.constructor.static = {};
		}
		return this.constructor.static;
	}

	get baseUrl(){
		return this.static.baseUrl;
	}

	set jsonData(json){
		this.data = this._proxyJsonModel(json);
	}

	setData(obj){
		this.data = new Proxy(obj, {
			get: (obj, prop)=>{
				return obj[prop];
			},
			set: (obj, prop, value)=>{
				if(obj[prop] != value){
					obj[prop] = value;
					if(this.dataListener[prop]){
						this.dataListener[prop]();
					}
					this.dataChange();
				}
				return true;
			}
		});
		this.dataChange();
	}
	_proxyJsonModel(localdata, path = []){
		let model = new Proxy({}, {
			get: (obj, prop)=>{
				return obj[prop];
			},
			set: (obj, prop, value)=>{
				/// proxy deep data
				if(typeof value =='object')
					value = this._proxyJsonModel(value,[...path, prop]);
				else if(Array.isArray(value))
					debugger;
				
				//assign the value
				obj[prop] = value;

				if(this.#ready){
					let varpath = [...path,prop].join('.');
					if(this.dataListener[varpath]){
						this.dataListener[varpath]();
					}
					this.dataChange();
				}

				return true;
			}
		});
		//copy data in
		for(let key of Object.keys(localdata)){
			model[key] = localdata[key];
		}
		return model;
	}

	interval(func, ms=250){
		if(func()){
			setTimeout(()=>{
				this.interval(func, ms);
			}, ms);
		}
	}

	bootQueue(item){
		this.#setupQueue.push(item);
	}

	async load(){
		return;
	}

	async ready(){
		while(this.#ready == false) {
			await this.sleep(10);
		}
	}

	async sleep(ms){
		await new Promise((r)=>setTimeout(r, ms));
	}

	markup(){
		return "";
	}

	addBinding(binding){
		// first run
		binding();
		// add the binding for later runs
		let bindId = this.bindingID++;
		this._bindings[bindId] = binding;
		return bindId;
	}

	bind(element = this, mappings = []){

		let repeaterElements = [];

		// grab all the stuff to process first
		let stuffs = [];
		for(let bind of Object.keys(BIND_ATTRIBUTES)){
			let attr = BIND_ATTRIBUTES[bind];
			let elements = element.querySelectorAll(`[${bind}]`);

			if(elements.length){
				stuffs.push({
					bind: bind,
					attr: attr,
					elements: elements
				});
			}
		}

		//console.log(stuffs);

		//then process it
		for(let stuff of stuffs){
			let {bind, attr, elements} = stuff;
			//console.log(attr);
			elementLoop:
			for(let ele of elements){

				//check we aren't the child of a repeater Element, which are handled by recursed bind calls
				let e = ele;
				while(e.parentElement!=null){
					e = e.parentElement;
					if(repeaterElements.includes(e)){
						continue elementLoop;
					}
				}
				

				// manipulate the input to replace tokens with relative data
				let valueName = ele.getAttribute(bind);
				for(let mapping of mappings){
					let regexp = new RegExp(mapping[0], "g");
					valueName = valueName.replace(regexp, mapping[1]);
				}
				let dataItem = valueName.replace(/\$(?=\w)/g, "this.data.");
				dataItem = dataItem.replace(/\#(?=\w)/g, `document.querySelector('#${this.id}').`);

				//console.log(dataItem);

				// remove the attr from the markup
				ele.removeAttribute(bind);

				// DEBUG
				if(attr=="debugger"){
					debugger;
					console.log(dataItem, eval(dataItem));
				}

				// LOOPING FUNCTIONAL
				if(attr=="for"){
					repeaterElements.push(ele);
					let template = ele.innerHTML;
					let forParts;
					if(dataItem.includes(" of "))
						forParts = dataItem.split(" of ");
					else
						forParts = dataItem.split(":");
					let arrayLocation = forParts[1].trim();
					let item = forParts[0].trim();					

					let arrayFunction = new AsyncFunction("try{return " + arrayLocation +"}catch(e){console.error(e);return []}");
					let count = 0;

					let buildArray = async ()=>{
						
						let array = await arrayFunction.call(this);
						// grab the array
						try{							
							if(count==array.length)
								return;
						}catch(e){
							debugger;
						}

						count = array.length;
						// clear old content
						ele.innerHTML = "";
						// TODO DESTROY OLD BINDINGS!
						// itterate
						for(let key of Object.keys(array)){
							// build a temporary wrapper for the markup
							let wrapper = document.createElement("div");
							wrapper.innerHTML = template;
							// process the subtree
							this.bind(wrapper, [[`\\$${item}`, `(${arrayLocation})[${key}]`], ...mappings]);
							// append it to parent
							// create a copy of the array otherwise it'll live update as we move items
							let children = [...wrapper.childNodes];
							for(let node of children) {
								ele.appendChild(node);
							}
						}
					};

					this.addBinding(()=>{
						
						//DESTROY old bindings...

						buildArray();
					});
					continue;
				}

				// FUNCTIONAL
				if(attr == "onclick"){
					//debugger;
					let func = new Function("return " + dataItem).bind(this);
					//console.log("return " + dataItem);
					ele[attr] = func;
					continue;
				}

			

				// data bind 
				if(attr == "data-data"){
					let as = dataItem.split(":");
					let arrayLocation = as[1].trim();
					let item = as[0].trim();

					let getFunc = new Function("try{return " + arrayLocation +"}catch{return ''}");

					this.addBinding(()=>{
						let value = getFunc.call(this);
						if(value!=null) {
							if(item==''){
								ele.setData(value);
							}else{
								ele.data[item] = value;
							}
							//ele.dataset[item] = value;
						}
					});
					continue;
				}

				let getFunc = new AsyncFunction("try{return " + dataItem +"}catch{return ''}");

				// INPUTS (two way bind)
				if(attr == "value"){
					// setting value -> two way binding
					let setFunc = new Function("v", dataItem + " = v;");
					if(ele.type == "checkbox"){
						this.addBinding(async ()=>{
							ele.checked = await getFunc.call(this);
						});

						ele.addEventListener("change", ()=>{
							setFunc.call(this, ele.checked);
						});
					}else{
						this.addBinding(async ()=>{
							ele.value = await getFunc.call(this);
						});

						ele.addEventListener("change", ()=>{
							setFunc.call(this, ele.value);
						});
					}
					continue;
				}

				if(attr == "show"){
					this.addBinding(async ()=>{
						let value = await getFunc.call(this);
						if(!value) {
							ele.style.display = "none";
						} else {
							ele.style.display = null;
						}
					});
					continue;
				}

				// BASIC ONE WAY BIND
				{
					// setting any other item -> one way binding
					this.addBinding(async ()=>{
						let value = await getFunc.call(this);
						if(value!=null) {
							ele[attr] = value;
						}
					});
				}
			}
		}
	}

	get attached(){
		return this.parentElement!=null;
	}

	connectedCallback(){
		if(!this.#attached){
			this.#attached = true;
			this.onAttach();
		}
	}

	disconnectedCallback(){
		if(this.#attached){
			this.#attached = false;
			this.onDetach();
		}
	}

	async onAttach(){
		//called when this element is added to the dom
		//console.log("ATTACHED "  + this.constructor.name);
	}

	onDetach(){
		//console.log("DETACHED "  + this.constructor.name);
	}

	remove(){
		if(this.attached){
			super.remove();
		}
	}

	async init(){

	}

	triggerEvent(event){
		this.dispatchEvent(new Event(event));
	}

	dataChange(){
		for(let binding of Object.values(this._bindings)){
			binding();
		}
		this.triggerEvent("change");
	}
}
//window.BasicComponent = BasicComponent;

/********** EXTENSIONS ********* */

_.registerExtension("css",(superc)=>{
	return class extends superc{

		constructor(data, flags){
			super(data, flags);
		}

		async load(){
			super.load();
			let css = this.styleSheet();
			if(css){
				this.bootQueue(css);
			}
		}

		styleSheet(){
			if(!this.static.css){
				this.static.css = true;
				let p = new Promise(async (res, rej) => {
					try{
						let path = `${this.baseUrl}/../${this.constructor.name}.css`;
						let f = await fetch(path);
						let css = await f.text();
						let style = document.createElement("style");
						style.textContent = css;
						document.head.appendChild(style);
						//console.log("Appending css " + this.constructor.name);
					}catch(e){
						console.error("Failed to css " + this.constructor.name);
					}

					res();
				});
				p.name = "CSS";
				return p;
			}
			return false;
		}
	};
});

_.registerExtension("html", (superc)=>{
	return class extends superc{

		constructor(data, flags){
			super(data, flags);
		}

		async load(){
			super.load();

			if(!this.static.html){
				let p = new Promise(async (res, rej) => {
					try{
						let path = `${this.baseUrl}/../${this.constructor.name}.html`;
						let f = await fetch(path);
						this.static.html = await f.text();
					}catch(e){
						console.error("Failed to html " + this.constructor.name);
					}
					res();
				});
				this.bootQueue(p);
			}
		}

		markup(){
			return this.static.html;
		}
	};
});