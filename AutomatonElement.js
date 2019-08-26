// used to prevent having to rebuild the class chain every component instance
const CHAINED_CLASS_CACHE = {};

let _ = (...classes)=>{
	let classKey = classes.join("|");
	if(CHAINED_CLASS_CACHE[classKey]!=null) {
		return CHAINED_CLASS_CACHE[classKey];
	}

	let c = BasicComponent;
	for(let clas of classes){
		if(typeof clas == "string") {
			c = _[clas.toLowerCase()](c);
		} else {
			c = clas(c);
		}
	}
	CHAINED_CLASS_CACHE[classKey] = c;
	return c;
};

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

function scriptLocal(){
	let err = new Error();
	let link = err.stack.split("(");
	link = link[1];
	link = link.split(")")[0];
	link = link.split(":");
	link.splice(-2, 2);
	link = link.join(":");

	return link;
}

const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

class BasicComponent extends HTMLElement{

	#attached = false;
	_bindings = {};
	#ready = false;

	#setupQueue = [];

	meta;

	constructor(data={}, meta = import.meta, flags = {}){
		super();

		this.meta = meta;

		this.id = "ui_"+UUID++;

		this.bindingID = 0;

		//TODO THE LOCATION STUFF IS CRAP
		//console.log(`BUILDING ${meta.url}` + this.constructor.name);
		//console.log(scriptLocal());

		//TODO register on _

		//debugging
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
			//console.log("RENDERING " + this.constructor.name);
			this.innerHTML = this.markup();
			this.bind();
			await this.init();
			this.dataChange();

			this.#ready = true;
		});
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

				//check we aren't the child of a repeater Element, which are handled but recursed bind calls
				for(let parent of repeaterElements){
					let e = ele;
					while(e.parentElement!=null){
						e = e.parentElement;
						if(e==parent){
							continue elementLoop;						
						}
					}
				}

				let valueName = ele.getAttribute(bind);
				// function to get the value of the desired data
				for(let mapping of mappings){
					let regexp = new RegExp(mapping[0], "g");
					valueName = valueName.replace(regexp, mapping[1]);
				}
				let dataItem = valueName.replace(/\$(?=\w)/g, "this.data.");
				dataItem = dataItem.replace(/\#(?=\w)/g, `document.querySelector('#${this.id}').`);

				//console.log(dataItem);

				ele.removeAttribute(bind);

				if(attr=="debugger"){
					debugger;
					console.log(dataItem, eval(dataItem));
				}

				// LOOPING FUNCTIONAL
				if(attr=="for"){
					repeaterElements.push(ele);
					let template = ele.innerHTML;
					let as = dataItem.split(":");
					let arrayLocation = as[1].trim();
					let item = as[0].trim();

					

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

_.css = (superc)=>{
	return class extends superc{

		constructor(data, meta, flags){
			super(data, meta, flags);
		}

		async load(){
			super.load();
			let css = this.styleSheet();
			if(css){
				this.bootQueue(css);
			}
		}

		styleSheet(){
			if(!this.constructor.css){
				this.constructor.css = true;
				let p = new Promise(async (res, rej) => {
					try{
						let path = `${this.meta.url}/../${this.constructor.name}.css`;
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
};

_.html = (superc)=>{
	return class extends superc{

		constructor(data, meta, flags){
			super(data, meta, flags);
		}

		async load(){
			super.load();

			if(!this.constructor.html){
				let p = new Promise(async (res, rej) => {
					try{
						let path = `${this.meta.url}/../${this.constructor.name}.html`;
						let f = await fetch(path);
						this.constructor.html = await f.text();
					}catch(e){
						console.error("Failed to html " + this.constructor.name);
					}
					res();
				});
				this.bootQueue(p);
			}
		}

		markup(){
			return this.constructor.html;
		}
	};
};