AFRAME.registerComponent('change-color-on-hover', {
	schema: {
	  color: {default: 'red'}
	},

	init: function () {
		let data = this.data;
		let el = this.el;  // The element we are looking at
		
		let previousColor = el.getAttribute('material').color;
		el.addEventListener('mouseenter', function () {
			previousColor = el.getAttribute('material').color;
			el.setAttribute('color', data.color);
		});

		el.addEventListener('mouseleave', function () {
			el.setAttribute('color', previousColor);
		});

		el.addEventListener('click', function () {
			previousColor = "black"
			el.setAttribute('color', previousColor);
		});
	}
});


AFRAME.registerComponent('cheeseplate-behavior', {
	schema: {
	  color: {default: 'red'}
	},

	init: function () {
		let data = this.data;
		let el = this.el;  // The element we are looking at
		
		let previousColor = el.getAttribute('material').color;
		el.addEventListener('mouseenter', function () {
			previousColor = el.getAttribute('material').color;
			el.setAttribute('color', data.color);
		});

		el.addEventListener('mouseleave', function () {
			el.setAttribute('color', previousColor);
		});
	}
});


Vue.component("cheeseplate", {
	template: `
		<a-box color="blue" 
			cheeseplate-behavior
			depth="2" height="2" width="2"
		>
		</a-box>
	`,

	props: ["room"]

})