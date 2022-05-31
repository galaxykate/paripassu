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

let cheeseplateCubes = []
for (var i = 0; i < 40; i++) {
  cheeseplateCubes.push(new Vector(Math.random(), 1, Math.random()))
}

AFRAME.registerComponent('plate-behavior', {
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
		 cheeseplateCubes.pop()
		});
    
    let colors = ["2 0 1", "-1 0 3", "-2 0 3"]
		 // el.setAttribute('color',"black");
    setInterval(() => {
//       Do something every N milliseconds
        let c = getRandom(colors)
         el.setAttribute('position', c);
    }, 5000)
	}
});


Vue.component("plate", {
	template: `
		<a-box color="blue" 
			plate-behavior
			depth="2" height="2" width="2" position="0 0 0"
		>
    
    <!-- make all the cheese cubes -->
      	<a-sphere color="orange" 
          radius="0.1" position="0 1.2 0"
          v-for="cube in cheeseplateCubes" :position="cube.toAFrame()"
        >
		</a-sphere>
    
    
	`,

  data() {
    return {
    cheeseplateCubes: cheeseplateCubes,
    }
  },

	props: ["room"]

})

AFRAME.registerComponent('change-image', {
	schema: {
	  // color: {default: 'red'}
	},

	init: function () {
		let data = this.data;
		let el = this.el;  // The element we are looking at
    
    let colors = ["#FF6347", "#FFB6C1", "#6495ED", "#20B2AA", "#DDA0DD", "#B0C4DE", "#FFDAB9", "#FFA07A"]
		 el.setAttribute('color',"#FFDEAD");
    setInterval(() => {
//       Do something every N milliseconds
        let c = getRandom(colors)
         el.setAttribute('color',c);
	}, 4000)
}
});