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
let bindings = {};
bindings[bindPrefix] = "value";
bindings[bindPrefix+"body"] = "innerHTML";
bindings[bindPrefix+"for"] = "for"; // for LOOOPs
bindings[bindPrefix+"show"] = "show"; // show
for(let attr of ["selected", "value", "min", "max", "innerHTML", "onclick"]){
	bindings[bindPrefix+attr] = attr;
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

class BasicComponent extends HTMLElement{

	#attached = false;
	#bindings = [];
	#ready = false;

	#setupQueue = [];

	meta;

	constructor(data={}, meta = import.meta){
		super();

		this.meta = meta;

		this.id = "ui_"+UUID++;

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

		this.data = new Proxy(data, {
			get: (obj, prop)=>{
				return data[prop];
			},
			set: (obj, prop, value)=>{
				data[prop] = value;
				if(this.dataListener[prop]){
					this.dataListener[prop]();
				}
				this.dataChange();
				return true;
			}
		});

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

	bind(element = this, mappings = []){


		// grab all the stuff to process first
		let stuffs = [];
		for(let bind of Object.keys(bindings)){
			let attr = bindings[bind];
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
			for(let ele of elements){

				let valueName = ele.getAttribute(bind);
				// function to get the value of the desired data
				for(let mapping of mappings){
					let regexp = new RegExp(mapping[0], "g");
					valueName = valueName.replace(regexp, mapping[1]);
				}
				let dataItem = valueName.replace(/\$(?=\w)/g, "this.data.");
				dataItem = dataItem.replace(/\#(?=\w)/g, `document.querySelector('#${this.id}').`);

				// LOOPING FUNCTIONAL
				if(attr=="for"){
					let template = ele.innerHTML;
					let as = dataItem.split(":");
					let arrayLocation = as[1].trim();
					let item = as[0].trim();

					let buildArray = ()=>{
						// clear old content
						ele.innerHTML = "";
						// grab the array
						let array = new Function("try{return " + arrayLocation +"}catch{return []}").call(this);
						// itterate
						for(let key of Object.keys(array)){
							// build a temporary wrapper for the markup
							let wrapper = document.createElement("div");
							wrapper.innerHTML = template;
							// process the subtree
							this.bind(wrapper, [[`\\$${item}`, `${arrayLocation}[${key}]`], ...mappings]);
							// append it to parent
							for(let node of wrapper.children) {
								ele.appendChild(node);
							}
						}
					};

					this.#bindings.push(()=>{
						//console.log("array change callback");
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

				let getFunc = new Function("try{return " + dataItem +"}catch{return ''}");

				// INPUTS (two way bind)
				if(attr == "value"){
					// setting value -> two way binding
					let setFunc = new Function("v", dataItem + " = v;");
					if(ele.type == "checkbox"){
						this.#bindings.push(()=>{
							ele.checked = getFunc.call(this);
						});

						ele.addEventListener("change", ()=>{
							setFunc.call(this, ele.checked);
						});
					}else{
						this.#bindings.push(()=>{
							ele.value = getFunc.call(this);
						});

						ele.addEventListener("change", ()=>{
							setFunc.call(this, ele.value);
						});
					}
					continue;
				}

				if(attr == "show"){
					this.#bindings.push(()=>{
						let value = getFunc.call(this);
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
					this.#bindings.push(()=>{
						let value = getFunc.call(this);
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
		for(let binding of this.#bindings){
			binding();
		}
		this.triggerEvent("change");
	}
}
//window.BasicComponent = BasicComponent;

/********** EXTENSIONS ********* */

_.css = (superc)=>{
	return class extends superc{

		constructor(data, meta){
			super(data, meta);
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

		constructor(data, meta){
			super(data, meta);
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
						//console.error(e);
						//typically a missing file is because it doesn't want to be styled
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