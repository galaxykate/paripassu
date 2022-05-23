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
			el.setAttribute('color', 'black');
		});
	}
});




