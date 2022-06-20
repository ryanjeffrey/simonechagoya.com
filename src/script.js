import './style.css'
import Rellax from 'rellax'
import gsap from 'gsap'
// import * as dat from 'lil-gui'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

/**
 * Base
 */

gsap.registerPlugin(ScrollTrigger);


gsap.from("#first-artwork", {
    autoAlpha: 0,
    duration: 3,
    delay: 0.5
});

var listones = gsap.utils.toArray(".listone");

listones.forEach((listone) => {
  gsap.from(listone, {
    autoAlpha: 0,
    scrollTrigger: {
      trigger: listone,
      start: 'top center',
      scrub: true,
      end: '+=500',
    //   toggleActions: 'play pause resume reverse'
    //   markers: true,
    },
  });
//   gsap.to(listone, {autoAlpha:0});
});

// Nav Menu
const navButton = document.getElementById("menu-button")

navButton.onclick = function toggleNav() {
  const x = document.getElementById("menu");
  if (x.style.width !== "100vw") {
    x.style.width = "100vw";
  } else {
    x.style.width = "0";
  }
};

// var navItems = gsap.utils.toArray(".navItem");

// navItems.forEach((navItem, i) => {
//   gsap.fromTo(navItem, {
//     y: -20,
//     delay: 0.5
//   }, {
//     duration: 1,
//     y: 0,
//     delay: 0.5 + (0.5 * i)
//   });
// });

// Cursor
// document.body.addEventListener("mousemove", function (e) {
//   var curX = e.clientX;
//   var curY = e.clientY;

//   document.getElementById("invertedcursor").style.left = curX - 10 + "px";
//   document.getElementById("invertedcursor").style.top = curY - 10 + "px";
// });

// Parallax
var rellax = new Rellax(".rellax", {
    center: true
});

// // Debug
// // const gui = new dat.GUI({
// //     width: 400
// // })

// // Canvas
// const canvas = document.querySelector('canvas.webgl')

// // Scene
// const scene = new THREE.Scene()

// /**
//  * Lights
//  */
// const ambientLight = new THREE.AmbientLight(0xffffff, 0.9)
// scene.add(ambientLight)

// const directionalLight = new THREE.DirectionalLight("#ffffff", 20)
// directionalLight.castShadow = true
// directionalLight.position.set(0, 1, 0)
// directionalLight.shadow.mapSize.set(1024, 1024)
// scene.add(directionalLight)

// /**
//  * Loaders
//  */
// // Texture loader
// const textureLoader = new THREE.TextureLoader()
// const cubeTextureLoader = new THREE.CubeTextureLoader()

// // Draco loader
// const dracoLoader = new DRACOLoader()
// dracoLoader.setDecoderPath('draco/')

// // GLTF loader
// const gltfLoader = new GLTFLoader()
// gltfLoader.setDRACOLoader(dracoLoader)

// /**
//  * Textures
//  */
// const bakedTexture = textureLoader.load('baked.jpg')
// bakedTexture.flipY = false
// bakedTexture.encoding = THREE.sRGBEncoding

// /**
//  * Environment map
//  */
// const environmentMap = cubeTextureLoader.load([
//     '/textures/environmentMaps/0/px.bmp',
//     '/textures/environmentMaps/0/nx.bmp',
//     '/textures/environmentMaps/0/py.bmp',
//     '/textures/environmentMaps/0/ny.bmp',
//     '/textures/environmentMaps/0/pz.bmp',
//     '/textures/environmentMaps/0/nz.bmp'
// ])
// environmentMap.encoding = THREE.sRGBEncoding
// scene.background = environmentMap
// scene.environment = environmentMap

// /**
//  * Materials
//  */
// // Baked material
// const bakedMaterial = new THREE.MeshBasicMaterial({ map: bakedTexture })

// // Pole light material
// // const poleLightMaterial = new THREE.MeshBasicMaterial({ color: 0xffffe5 })

// // Portal light material
// // const portalLightMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })

// /**
//  * Model
//  */
// gltfLoader.load(
//     'simone-gallery.glb',
//     (gltf) =>
//     {   
//         // gltf.scene.traverse(function (child) {
//         //   if (child.isMesh) {
//         //     child.castShadow = true;
//         //     child.receiveShadow = true;
//         // })

//         scene.add(gltf.scene)  
        

//     //     // Get each object
//     //     const bakedMesh = gltf.scene.children.find((child) => child.name === 'baked')
//     //     const portalLightMesh = gltf.scene.children.find((child) => child.name === 'portalLight')
//     //     const poleLightAMesh = gltf.scene.children.find((child) => child.name === 'poleLightA')
//     //     const poleLightBMesh = gltf.scene.children.find((child) => child.name === 'poleLightB')

//     //     // Apply materials
//     //     bakedMesh.material = bakedMaterial
//     //     portalLightMesh.material = portalLightMaterial
//     //     poleLightAMesh.material = poleLightMaterial
//     //     poleLightBMesh.material = poleLightMaterial
//     }
// )


// /**
//  * Sizes
//  */
// const sizes = {
//     width: window.innerWidth,
//     height: window.innerHeight
// }

// window.addEventListener('resize', () =>
// {
//     // Update sizes
//     sizes.width = window.innerWidth
//     sizes.height = window.innerHeight

//     // Update camera
//     camera.aspect = sizes.width / sizes.height
//     camera.updateProjectionMatrix()

//     // Update renderer
//     renderer.setSize(sizes.width, sizes.height)
//     renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
// })

// /**
//  * Camera
//  */
// // Base camera
// const camera = new THREE.PerspectiveCamera(40, sizes.width / sizes.height, 0.1, 500)
// camera.position.x = 0
// camera.position.y = 40
// camera.position.z = 100
// scene.add(camera)

// // Controls
// const controls = new OrbitControls(camera, canvas)
// controls.enableDamping = true

// controls.minPolarAngle = 1

// /**
//  * Renderer
//  */
// const renderer = new THREE.WebGLRenderer({
//     canvas: canvas,
//     antialias: true
// })
// renderer.outputEncoding = THREE.sRGBEncoding
// renderer.setSize(sizes.width, sizes.height)
// renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
// renderer.toneMapping = THREE.ACESFilmicToneMapping
// renderer.shadowMap.enabled = true
// renderer.shadowMap.type = THREE.PCFSoftShadowMap
// renderer.setClearColor('#ffffff')

// /**
//  * Animate
//  */
// const clock = new THREE.Clock()

// const tick = () =>
// {
//     const elapsedTime = clock.getElapsedTime()

//     // Update controls
//     controls.update()

//     // Render
//     renderer.render(scene, camera)

//     // Call tick again on the next frame
//     window.requestAnimationFrame(tick)
// }

// tick()