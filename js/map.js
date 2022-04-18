

//==============================================================================
// Utilities

function labelStyle({label, stroke="#000", color="#fff", icon, fontSize=12, scale=20}) {
	if (stroke && !(typeof stroke == "string" && stroke[0] == "#"))
		stroke = colorToHex(stroke)

	if (color && !(typeof color == "string" && color[0] == "#"))
		color = colorToHex(color)

	let labelStyle = new ol.style.Style({
		text: new ol.style.Text({
			font: `${fontSize}px Calibri,sans-serif`,
			overflow: true,
			fill: new ol.style.Fill({
				color: 	color
			}),
			stroke: new ol.style.Stroke({
				color: stroke,
				width: 3
			}),
			offsetY: -scale
		})
	})
	labelStyle.getText().setText(label);
	return labelStyle
}


function iconStyle({color="#000", icon, scale}) {
	if (color && !(typeof color == "string" && color[0] == "#"))
		color = colorToHex(color)

	
	return new ol.style.Style({
		image: new ol.style.Icon({
			color: color,
			anchor: [.5, 1],
			anchorXUnits: 'fraction',
			anchorYUnits: 'fraction',
			src: `img/icons/${icon}_white_24dp.svg`,
			// src: 'icon2.png',
			scale: scale
		})
	});
}



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



let noise = new SimplexNoise()


// A map made out of openlayers data and ..landmarks?

class InteractiveMap {
	constructor({ranges, featureToStyle, mapCenter, landmarks, initializeMap, initializeLandmark, update, onEnterRange, onExitRange}) {
		this.update = update
		this.center = mapCenter
		this.ranges = ranges
		this.useLocation = false
		this.automove = false
		this.featureToStyle = featureToStyle
		this.initializeLandmark = initializeLandmark
		this.onEnterRange = onEnterRange
		this.onExitRange = onExitRange

		// this.landmarkToMarker = landmarkToMarker
		
		this.landmarks = []

		this.randomWalk = true

		let count = 0; 
		setInterval(() => {
			if (!this.paused) {
				count++

				this.baseUpdate(count)
				this.update(count)
			}
		}, UPDATE_RATE) 

		
		// 
		this.markerLayer = new ol.layer.Vector({

			source: new ol.source.Vector({
				features: []
			}),

			style: (marker) => {

				// How far is the player?
				let d = getDistance(marker, this.playerMarker)
				// console.log(d)
				let scale = lerpBetween({
					x: d, 
					y0: .12,
					y1: .07,
					x0: 0,
					x1: 100,
					pow: 2
				})*10	

				let styles = []
				let settings = this.featureToStyle(marker.landmark)
				
				// Add the bg icon
				if (!settings.noBG) {
					styles.push(iconStyle({
						color: settings.bgColor,
						icon: "lens",
						scale: scale
					}))
				}
		

				if (settings.icon) {
					// Add the bg icon
					styles.push(iconStyle({
						color: settings.iconColor,
						icon: settings.icon,
						scale: scale
					}))
				}

	
				if (settings.label) {
					styles.push(labelStyle({
						label: settings.label,
						fontSize: settings.fontSize,

					}))
				}

				
				return styles;
			}
		})

		// Player location
		this.userLocation = this.center.slice()


		this.playerMarker = this._placeMarker({
			pos: this.userLocation
		}, true)


		initializeMap.call(this)
	}


	baseUpdate(frameCount) {
		if (map.automove) {
			moveMarker({
				marker:map.playerMarker,
				r: AUTOMOVE_SPEED,
				theta: 10*noise.noise2D(frameCount*.01, 1),
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

		this.landmarks.forEach(landmark => {
				if (!landmark.isPlayer) {
				let d = getDistance(landmark.marker, this.playerMarker)
				landmark.distanceToPlayer = Math.round(d)

				let maxLevel = -1
				this.ranges.forEach((range, index) => {
					if (landmark.distanceToPlayer < range) {
						maxLevel = index
						// console.log(landmark.name, range, landmark.distanceToPlayer)
					}
				})

				if (maxLevel < landmark._level) {
					// Leaving the level
					this.onExitRange(landmark, maxLevel, landmark._level, landmark.distanceToPlayer)
				}
				if (maxLevel > landmark._level) {
					// Leaving the level
					this.onEnterRange(landmark, maxLevel, landmark._level, landmark.distanceToPlayer)
				}
				landmark._level = maxLevel
			}
		})



		// console.log(this.landmarks.map(l => l.distanceToPlayer))

	}

	get playerCoords() {
		return this.playerMarker.getGeometry().getCoordinates()
	}

	setUserPosFromLatLon(coords) {
		if (!Array.isArray(coords) || coords.length != 2)
			throw("incorrect coordinates")

		// coords = [ -87.6889967, 42.0519228]
		let coords2 = ol.proj.fromLonLat(coords)
		this.playerMarker.getGeometry().setCoordinates(coords2)
		console.log("Set playerMarker coords", this.playerCoords)
	}
	requestLocation() {

		if (navigator.geolocation) {
			navigator.geolocation.getCurrentPosition((pos) => {
				console.log("Geolocation", pos)
				let coords = [pos.coords.longitude, pos.coords.latitude]
				this.setUserPosFromLatLon(coords)
			});
		} else {
			console.warn("Geolocation is not supported by this browser.")
			this.errorMessage = "Geolocation is not supported by this browser.";
		}
		
	}

	

	toggleRandomWalk() {
		this.randomWalk = !this.randomWalk
	}

	_placeMarker(landmark, isPlayer=false) {
		// Create a marker (landmark + geometry)
		var marker = new ol.Feature({
			geometry: new ol.geom.Point(landmark.pos)
		});

		landmark._level = -1
		landmark.isPlayer = isPlayer
		this.initializeLandmark(landmark, isPlayer)
		marker.landmark = landmark
		landmark.marker = marker
		this.markerLayer.getSource().addFeature(marker);
		this.landmarks.push(landmark)

		return marker
	}

	createLandmark(landmark) {
		this._placeMarker(landmark)
	}


	loadLandmarks(landmark_set, filterLandmarks) {

		// Fetch a set of landmarks and create markers from them
		fetch(`maps/${landmark_set}.json`)
		.then(response => response.json())
		.then(json => {

			// Deal with the loaded landmarks
			json.forEach(data => {
				
				let landmark = {
					pos: ol.proj.fromLonLat(data.geometry.coordinates),
					src: landmark_set
				}
				
				landmark.openMapData = data.properties
				
				// Add the marker
				if (filterLandmarks(landmark)) {
					// Decorate the marker
					this._placeMarker(landmark)
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

			// Layers: map tile and 
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
