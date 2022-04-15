


let noise = new SimplexNoise()

// Given an OpenLayers marker, move it to a new position (or offset from its current)
function moveMarker({marker, x=0, y=0, r=0, theta=0, pos, lerpTo, lerpAmt}) {
	let pt = marker.getGeometry()
	let coord = pos?pos.slice(): pt.getCoordinates() 

	coord[0] += x
	coord[1] += y
	coord[0] += r*Math.cos(theta)
	coord[1] += r*Math.sin(theta)

	if (lerpTo) {
		coord[0] = coord[0]*(1-lerpAmt) + lerpAmt*lerpTo[0]
		coord[1] = coord[1]*(1-lerpAmt) + lerpAmt*lerpTo[1]
	}
	pt.setCoordinates(coord)
	return marker
}

function clonePolarOffset(v, r, theta) {
	return [v[0] + r*Math.cos(theta),v[1] + r*Math.sin(theta)]
}

function cloneOffset(v, v1, x=0, y=0) {
	Vue.set(v, 0, v1[0] + x)
	Vue.set(v, 1, v1[1] + y)
}

function polarOffset(v, r, theta) {
	Vue.set(v, 0, v[0] + r*cos(theta))
	Vue.set(v, 1, v[1] + r*sin(theta))
}

function getDistance(p0, p1) {
	if (p0.getGeometry)
		p0 = p0.getGeometry().getCoordinates()
	if (p1.getGeometry)
		p1 = p1.getGeometry().getCoordinates()
	// console.log(p0, p1)
	return Math.sqrt(Math.pow(p1[0] - p0[0], 2) + Math.pow(p1[1] - p0[1], 2))
}

// function lerp

// function animatePos(pos, center) {
// 	let count = 0
// 	return setInterval(() => {
// 		count++
		
// 		let r = 10
// 		let theta = 10*noise.noise2D(count*.01)
// 		let x = pos[0]+ r*Math.cos(theta)
// 		let y = pos[1]+ r*Math.sin(theta)
		
// 		// console.log(pos)
// 		let lerp = .99
// 		if (center) {
// 			x = x*(1-lerp) + center[0]*lerp
// 			y = y*(1-lerp) + center[1]*lerp
// 		}
// 		Vue.set(pos, 0, x)
// 		Vue.set(pos, 1, x)
// 		// console.log(pos)
// 	}, 100)
// }


// A map made out of openlayers data and ..landmarks?

class InteractiveMap {
	constructor({mapCenter, landmarks, landmarkToMarker, update}) {
		this.update = update
		this.center = mapCenter
		this.useLocation = false
		this.automove = false

		this.landmarkToMarker = landmarkToMarker
		
		
		this.randomWalk = true

		let count = 0; 
		setInterval(() => {
			if (!this.paused) {
				count++

				this.baseUpdate(count)
				this.update(count)
			}
		}, 100) 

		landmarks = []
		for (var i = 0; i < 10; i++) {
			let p2 = clonePolarOffset(NU_CENTER, 400*Math.random() + 300, 20*Math.random())
			landmarks.push({
				name: words.getRandomWord(),
				pos: p2
			})
		}

		// Starting landmarks
		this.features = landmarks.map(landmark => {
			let marker = new ol.Feature({
				geometry: new ol.geom.Point(landmark.pos),
				name: landmark.name,
			})
			landmarkToMarker(marker)
			return marker
		})

		// Player location
		this.userLocation = this.center.slice()
		this.playerMarker = new ol.Feature({
			geometry: new ol.geom.Point(this.userLocation),
			name: "PLAYER",
		})
		this.features.push(this.playerMarker)


		this.markerLayer = new ol.layer.Vector({

			source: new ol.source.Vector({
				features: this.features
			}),

			style: (feature) => {
				// How far is the player?
				let d = getDistance(feature, this.playerMarker)
				// console.log(d)
				let scale = lerpBetween({
					x: d, 
					y0: .2,
					y1: .07,
					x0: 0,
					x1: 100,
					pow: 1
				})
				
				var iconBG = new ol.style.Style({
					image: new ol.style.Icon({
						color: feature.color?colorToHex(feature.color):"#FFF",
      					anchor: [.5, 1],
						anchorXUnits: 'fraction',
						anchorYUnits: 'fraction',
						src: 'img/icons/lens_white_24dp.svg',
						// src: 'icon2.png',
						scale: scale*14
					})

				});

				// How do we style this feature?
				// https://stackoverflow.com/questions/64529695/openlayers-6-add-maker-labels-or-text
				var iconStyle = new ol.style.Style({
					image: new ol.style.Icon({
						color: '#000000',
      					anchor: [.5, 1],
						anchorXUnits: 'fraction',
						anchorYUnits: 'fraction',
						src: 'img/icons/local_cafe_white_24dp.svg',
						// src: 'icon2.png',
						scale: scale*10
					})

				});

				// How do we style this feature?
				// https://stackoverflow.com/questions/64529695/openlayers-6-add-maker-labels-or-text
				
				

				// The label style is its name

				let labelStyle = new ol.style.Style({
					text: new ol.style.Text({
						font: '12px Calibri,sans-serif',
						overflow: true,
						fill: new ol.style.Fill({
							color: 	feature.color?colorToHex(feature.color):"#000"
						}),
						stroke: new ol.style.Stroke({
							color: '#fff',
							width: 3
						}),
						offsetY: -scale*40
					})
				});

				labelStyle.getText().setText(feature.get('name'));
				return [iconBG, iconStyle,labelStyle];
			}
		})
	}

	baseUpdate(frameCount) {
		if (map.automove) {
			moveMarker({
				marker:map.playerMarker,
				r: 40,
				theta: 10*noise.noise2D(frameCount*.1, 1),
				lerpTo:NU_CENTER,
				lerpAmt: .01
			})
		}

		if (map.useLocation) {
			if (frameCount % 10 == 0) {
				console.log("CHECK LOCATION", frameCount)
			
				// Check location every N ticks
				// Checking lcoation uses a lot of battery!
				map.requestLocation()
			}
		}
	}

	requestLocation() {

		if (navigator.geolocation) {
			navigator.geolocation.getCurrentPosition((pos) => {
				console.log("Geolocation", pos)
				let coords = [pos.coords.latitude, pos.coords.longitude]
				console.log("geo pos", coords)
				console.log("marker", this.playerMarker.getGeometry().getCoordinates())
			});
		} else {
			console.warn("Geolocation is not supported by this browser.")
			this.errorMessage = "Geolocation is not supported by this browser.";
		}
		
	}

	toggleRandomWalk() {
		this.randomWalk = !this.randomWalk
	}

	loadLandmarks(landmark_set, filterLandmarks) {
		fetch(`maps/${landmark_set}.json`)
		.then(response => response.json())
		.then(json => {

			// Deal with the loaded landmarks
			json.forEach(landmark => {
				// console.log(landmark)
				var marker = new ol.Feature({
					name: "TEST",
					// Convert to non-latlon
					geometry: new ol.geom.Point(ol.proj.fromLonLat(landmark.geometry.coordinates))
				});

				// Decorate the marker
				this.landmarkToMarker(landmark, marker)

				// Add the marker
				if (filterLandmarks(landmark)) {
					this.markerLayer.getSource().addFeature(marker);
				}


			})
			
		});
	}


	renderMap(el, popupEl) {
		// Render an OpenLayers map on the DOM
		// https://openlayers.org/en/latest/doc/quickstart.html

		
		
		// Make a map with a layer for the base map
		// and a layer for icons

		this.layerMap = new ol.Map({
			target: el,
			layers: [
				// Map tile (drawn streets, etc)
				new ol.layer.Tile({
					source: new ol.source.OSM()
				}),
				this.markerLayer
				
			],
			view: new ol.View({
				center: this.center,
				zoom: 15
			})
		});

		this.layerMap.on('click', (evt) => {
			let pos = ol.proj.transform(evt.coordinate, 'EPSG:3857', 'EPSG:4326')
			
			moveMarker({
				marker: this.playerMarker,
				pos:evt.coordinate
			})
			

		})

		// const popup = new ol.Overlay({
		// 	element: popupEl,
		// 	positioning: 'bottom-center',
		// 	stopEvent: false,
		// });
		// this.layerMap.addOverlay(popup);
	}
}