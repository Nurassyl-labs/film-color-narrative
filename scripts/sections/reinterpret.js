// D部分 - 重看电影模块
// D1: 全景数据视图 - 时间序列分析

let d1CachedMovies = {};
let d1CurrentMovieId = 'tt0133093'; // Default to The Matrix
let d1ActiveMetrics = { sentiment: true, density: false, brightness: true, saturation: false, hue: false };
let d1Chart = null;
let d1MovieData = null;
let movieChineseNames = {};

// D2: 色彩情绪放映机
let d2State = {
  movieData: null,
  timeline: [],
  segments: [],
  currentTime: 0,
  totalDuration: 0,
  isPlaying: false,
  speed: 1,
  animFrameId: null,
  particles: [],
  currentColor: [128, 128, 128],
  targetColor: [128, 128, 128],
  currentSentiment: 0,
  currentDensity: 0,
  currentSegmentIdx: -1,
  canvas: null,
  ctx: null,
  dpr: 1,
  width: 0,
  height: 0,
  cx: 0,
  cy: 0,
  orbRadius: 0,
  lastSegmentTitle: '',
  // Mini barcode
  miniCanvas: null,
  miniCtx: null,
  miniBarcodeDrawn: false,
};

// Helper to format time
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Simple CSV parser supporting quotes
function parseCSV(text) {
  const lines = text.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
    const obj = {};
    headers.forEach((h, i) => {
      const colVal = cols[i] ? cols[i].replace(/^"|"$/g, '').trim() : '';
      obj[h.trim()] = colVal;
    });
    return obj;
  });
}

// Loader for movie JSON data
async function loadD1MovieData(movieId) {
  if (d1CachedMovies[movieId]) return d1CachedMovies[movieId];
  try {
    const res = await fetch(`assets/data/${movieId}.json`);
    if (!res.ok) throw new Error("JSON not found");
    const data = await res.json();
    d1CachedMovies[movieId] = data;
    return data;
  } catch (e) {
    console.error("Failed to load movie JSON data for", movieId, e);
    return null;
  }
}

// Load movie names mapping from external file
async function loadD1MovieNamesMapping() {
  try {
    const response = await fetch('assets/data/movie-names-mapping.json');
    const data = await response.json();
    movieChineseNames = data.mapping || {};
    console.log(`✅ [D1] Loaded ${Object.keys(movieChineseNames).length} movie name mappings`);
  } catch (error) {
    console.error('❌ [D1] Failed to load movie name mapping:', error);
  }
}

// Helper function to get movie name
function getD1ChineseName(englishTitle) {
  return englishTitle;
}

// Populate movie select dropdown
function populateD1MovieSelect(selectEl, movies, defaultId) {
  selectEl.innerHTML = '';
  
  movies.forEach(m => {
    const option = document.createElement('option');
    option.value = m.IMDb_ID;
    option.textContent = `${m.Title} (${m.Year})`;
    
    if (m.IMDb_ID === defaultId) {
      option.selected = true;
    }
    
    selectEl.appendChild(option);
  });
}

// Select D1 movie independently
async function selectD1Movie(movieId) {
  d1CurrentMovieId = movieId;
  
  // Update select element value
  const d1SelectEl = document.getElementById('d1-movie-select');
  if (d1SelectEl) d1SelectEl.value = movieId;

  // Show loading indicator
  const d1Loader = document.getElementById('d1-loading');
  if (d1Loader) d1Loader.style.display = 'block';

  // Load JSON
  const data = await loadD1MovieData(movieId);
  d1MovieData = data;

  if (d1Loader) d1Loader.style.display = 'none';

  if (!data) return;

  // Update D1 movie poster card
  updateD1MovieMetadata(data);

  // Render D1 timeline chart
  renderD1Timeline(data);
}

// Update D1 sidebar metadata card
function updateD1MovieMetadata(data) {
  const posterEl = document.getElementById('d1-poster');
  const titleEl = document.getElementById('d1-title');
  const yearEl = document.getElementById('d1-year');
  const genreEl = document.getElementById('d1-genre');
  const durationEl = document.getElementById('d1-duration');
  const ratingEl = document.getElementById('d1-rating');

  if (posterEl) {
    posterEl.src = data.poster || 'assets/posters/placeholder.jpg';
    posterEl.onerror = () => {
      posterEl.src = 'https://m.media-amazon.com/images/M/MV5BMTMxNTMwODM0NF5BMl5BanBnXkFtZTcwODAyMTk2Mw@@._V1_QL75_UX380_CR0,0,380,562_.jpg';
    };
  }
  
  // Show Chinese + English title
  const chineseName = getD1ChineseName(data.title);
  if (titleEl) titleEl.innerText = `${chineseName}\n${data.title}`;
  
  if (yearEl) yearEl.innerText = data.year;
  if (genreEl) genreEl.innerText = data.genre;
  if (durationEl) durationEl.innerText = `${Math.round(data.duration_seconds / 60)} min`;
  if (ratingEl) ratingEl.innerText = data.rating;
}

// Setup D1 metric toggle buttons
function setupD1MetricToggles() {
  const toggleContainer = document.getElementById('d1-toggles');
  if (!toggleContainer) return;

  const buttons = toggleContainer.querySelectorAll('.toggle-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      const metric = this.dataset.metric;
      const checkbox = this.querySelector('input[type="checkbox"]');

      // 允许多选，直接切换状态
      d1ActiveMetrics[metric] = !d1ActiveMetrics[metric];

      checkbox.checked = d1ActiveMetrics[metric];

      // Update button active state
      this.classList.toggle('active', checkbox.checked);

      // Re-render D1 chart with new metrics
      if (d1MovieData) {
        renderD1Timeline(d1MovieData);
      }
    });
  });
}

// Render D1 Timeline chart (multi-axis with barcode)
function renderD1Timeline(data) {
  if (!d1Chart || !data) return;

  const timeline = data.timeline;
  const segments = data.segments || [];

  const series = [];
  const legendData = [];
  const yAxisConfigs = [];

  let yAxisIndex = 0;

  // Metrics config
  const metricConfig = {
    'sentiment': {
      name: 'Dialogue Sentiment',
      label: 'Dialogue Sentiment',
      color: '#5eead4',
      getValue: (p) => p.sentiment,
      min: -1,
      max: 1
    },
    'density': {
      name: 'Dialogue Density',
      label: 'Dialogue Density',
      color: '#ff7a46',
      getValue: (p) => p.density,
      lineStyle: { type: 'dashed' }
    },
    'brightness': {
      name: 'Scene Brightness',
      label: 'Brightness',
      color: '#fadb14',
      getValue: (p) => p.brightness / 50 - 1,
      min: -1,
      max: 1
    },
    'saturation': {
      name: 'Scene Saturation',
      label: 'Saturation',
      color: '#c678dd',
      getValue: (p) => p.saturation / 50 - 1,
      min: -1,
      max: 1
    },
    'hue': {
      name: 'Scene Hue',
      label: 'Hue',
      color: '#ff6b9d',
      getValue: (p) => {
        const c = p.barcode_color;
        const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        if (max === min) return 0;
        let h = 0;
        const d = max - min;
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
        return h * 360 / 180 - 1;
      },
      min: -1,
      max: 1
    }
  };

  // 遍历所有活跃的指标
  Object.keys(d1ActiveMetrics).forEach(metric => {
    if (!d1ActiveMetrics[metric]) return;

    const config = metricConfig[metric];
    legendData.push(config.name);

    const seriesItem = {
      name: config.name,
      type: 'line',
      smooth: true,
      showSymbol: false,
      yAxisIndex: yAxisIndex,
      lineStyle: { width: 1.5, color: config.color, ...(config.lineStyle || {}) },
      data: timeline.map(p => [p.time, config.getValue(p)])
    };

    if (metric === 'sentiment') {
      seriesItem.areaStyle = {
        opacity: 0.28,
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(94, 234, 212, 0.5)' },
          { offset: 0.5, color: 'rgba(14, 15, 20, 0.05)' },
          { offset: 1, color: 'rgba(255, 56, 86, 0.5)' }
        ])
      };
    }

    series.push(seriesItem);

    // Y轴配置（极简风格）
    yAxisConfigs.push({
      type: 'value',
      show: true,
      position: 'left',
      offset: yAxisIndex * 35,
      name: config.label,
      nameTextStyle: {
        color: config.color,
        fontSize: 9,
        padding: [0, 0, 0, 5]
      },
      axisLabel: {
        color: config.color,
        fontSize: 8,
        margin: 8
      },
      axisLine: {
        show: true,
        lineStyle: { color: config.color, width: 1 }
      },
      splitLine: yAxisIndex === 0 ? { lineStyle: { color: '#181920', width: 1 } } : { show: false },
      ...(config.min !== undefined ? { min: config.min, max: config.max } : {})
    });

    yAxisIndex++;
  });

  // 计算时间范围
  const totalDuration = timeline.length > 0 ? timeline[timeline.length-1].time : 100;
  const timeMin = 0;
  const timeMax = totalDuration;

  // Set options
  d1Chart.setOption({
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(15,15,20,0.95)',
      borderColor: '#444',
      textStyle: { color: '#fff', fontSize: 12 },
      formatter: function(params) {
        const timeSec = params[0]?.value[0] || 0;
        let html = `<div style="font-weight:bold;color:var(--fc-accent-cool);margin-bottom:4px;">${formatTime(timeSec)}</div>`;

        params.forEach(param => {
          html += `<div>${param.marker} ${param.seriesName}: <strong>${param.value[1].toFixed(3)}</strong></div>`;
        });

        const closestPoint = timeline.reduce((prev, curr) =>
          Math.abs(curr.time - timeSec) < Math.abs(prev.time - timeSec) ? curr : prev
        );

        if (closestPoint && closestPoint.barcode_color) {
          const c = closestPoint.barcode_color;
          html += `<div style="margin-top:6px;border-top:1px solid #333;padding-top:4px;">`;
          html += `Color: <span style="display:inline-block;width:40px;height:12px;border-radius:2px;background:rgb(${c[0]},${c[1]},${c[2]})"></span> RGB(${c.join(',')})</div>`;
        }

        return html;
      }
    },
    legend: {
      data: legendData,
      textStyle: { color: '#888', fontSize: 11 },
      top: 5,
      left: 'center'
    },
    grid: {
      top: '18%',
      left: `${Math.min(Math.max(yAxisIndex * 4, 10), 25)}%`,
      right: '5%',
      bottom: '20%',
      containLabel: false
    },
    xAxis: {
      type: 'value',
      min: timeMin,
      max: timeMax,
      name: 'Time (s)',
      nameLocation: 'middle',
      nameGap: 25,
      nameTextStyle: { color: '#777', fontSize: 10 },
      axisLabel: {
        color: '#666',
        formatter: (val) => formatTime(val),
        fontSize: 10
      },
      splitLine: { lineStyle: { color: '#181920', width: 1 } }
    },
    yAxis: yAxisConfigs,
    series: [
      ...series,
      // Color barcode series
      {
        name: 'Color Barcode',
        type: 'custom',
        renderItem: function(params, api) {
          // 使用坐标系统正确映射
          const xVal = api.value(0);
          const point = api.coord([xVal, -1.5]); // 固定在Y=-1.5的位置

          // 计算每个条的宽度
          const nextXVal = api.value(0) + (totalDuration / timeline.length);
          const nextPoint = api.coord([nextXVal, -1.5]);
          const barWidth = Math.max(nextPoint[0] - point[0], 2);

          return {
            type: 'rect',
            shape: {
              x: point[0],
              y: point[1],
              width: barWidth,
              height: 20
            },
            style: {
              fill: api.value(2)
            }
          };
        },
        encode: {
          x: 0,
          y: 1
        },
        data: timeline.map((p, idx) => [
          p.time,
          -1.5,
          p.barcode_color ? `rgb(${p.barcode_color.join(',')})` : '#888'
        ]),
        z: -1,
        silent: true,
        animation: false
      },
      // Plot chapter markers
      {
        name: 'Plot Chapters',
        type: 'custom',
        renderItem: function(params, api) {
          const seg = api.value(2);
          if (!seg) return null;

          const x = api.coord([api.value(0), -1.5])[0];
          const yBottom = api.coord([api.value(0), -1.5])[1] + 22;
          const yTop = yBottom + 24;
          const color = '#aaa';

          const children = [{
            type: 'line',
            shape: { x1: x, y1: yBottom, x2: x, y2: yTop },
            style: { stroke: color, lineWidth: 1, lineDash: [3, 2] }
          }];

          // 如果有标题且段宽足够，渲染文字标签
          const title = seg._label;
          if (title) {
            const labelX = api.coord([seg._labelX, -1.5])[0];
            const labelY = yTop + 6;
            children.push({
              type: 'rect',
              shape: { x: labelX - seg._labelW / 2, y: labelY - 1, width: seg._labelW, height: 18 },
              style: { fill: 'rgba(30,35,45,0.92)', stroke: '#666', lineWidth: 1 },
              z2: 1
            });
            children.push({
              type: 'text',
              style: {
                text: title, x: labelX, y: labelY + 9,
                fill: '#ccc', font: '9px sans-serif',
                textAlign: 'center', textVerticalAlign: 'middle'
              },
              z2: 2
            });
          }

          return { type: 'group', children };
        },
        encode: { x: 0 },
        data: (() => {
          const pts = [];
          segments.forEach((seg, idx) => {
            const st = seg.start_time || (idx === 0 ? 0 : segments[idx - 1]?.end_time || 0);
            const et = seg.end_time || totalDuration;
            if (st >= et) return;

            const title = seg.title || '';
            const displayTitle = title.length > 12 ? title.substring(0, 11) + '…' : title;
            const segWidth = (et - st) / totalDuration;

            pts.push({
              value: [st, -1.5, {
                _isBoundary: true,
                _label: segWidth > 0.03 ? displayTitle : '',
                _labelX: st + (et - st) / 2,
                _labelW: Math.min(segWidth * totalDuration * 0.8, 160)
              }],
              itemStyle: { color: '#aaa' }
            });
          });

          // 末尾边界
          const lastSeg = segments[segments.length - 1];
          const lastEnd = lastSeg?.end_time || totalDuration;
          if (lastEnd < totalDuration * 0.99) {
            pts.push({
              value: [lastEnd, -1.5, { _isBoundary: true, _label: '', _labelX: 0, _labelW: 0 }],
              itemStyle: { color: '#aaa' }
            });
          }

          return pts;
        })(),
        z: 10,
        silent: false,
        animation: false
      }
    ],
    animationDuration: 800
  }, true);

  window.showSegmentTooltip = function(event, seg, index) {
    if (!d1Chart) return;

    const container = d1Chart.getDom();
    let tooltipEl = document.getElementById('d1-segment-tooltip');

    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.id = 'd1-segment-tooltip';
      tooltipEl.style.cssText = `
        position: absolute;
        background: rgba(15, 15, 20, 0.97);
        border: 1px solid #444;
        border-radius: 6px;
        padding: 12px;
        color: #fff;
        font-size: 12px;
        line-height: 1.6;
        max-width: 300px;
        pointer-events: none;
        z-index: 9999;
        box-shadow: 0 4px 16px rgba(0,0,0,0.6);
        display: none;
      `;
      container.style.position = 'relative';
      container.appendChild(tooltipEl);
    }

    const title = seg.title || `Segment ${index + 1}`;
    const startTimeVal = seg.start_time || (index === 0 ? 0 : segments[index - 1]?.end_time || 0);
    const endTimeVal = seg.end_time || totalDuration;
    const startTime = formatTime(startTimeVal);
    const endTime = formatTime(endTimeVal);
    const description = seg.description || '';
    const emotion = seg.avg_sentiment !== undefined ?
      (seg.avg_sentiment > 0.3 ? 'Positive' :
       seg.avg_sentiment < -0.3 ? 'Negative' : 'Neutral') : '';

    let html = `<div style="font-weight:bold;color:#ffa502;margin-bottom:8px;font-size:13px;">📽 ${title}</div>`;
    html += `<div style="margin-bottom:4px;">⏱ Time: ${startTime} - ${endTime}</div>`;
    if (emotion) html += `<div style="margin-bottom:4px;">😊 Sentiment: <strong>${emotion}</strong></div>`;
    if (description) html += `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #333;font-size:11px;color:#aaa;line-height:1.5;">${description}</div>`;

    tooltipEl.innerHTML = html;

    const rect = container.getBoundingClientRect();
    const x = event.offsetX || event.layerX || 0;
    const y = event.offsetY || event.layerY || 0;

    tooltipEl.style.left = `${Math.min(x + 10, rect.width - 320)}px`;
    tooltipEl.style.top = `${y - 130}px`;
    tooltipEl.style.display = 'block';
  };

  window.hideSegmentTooltip = function() {
    const tooltipEl = document.getElementById('d1-segment-tooltip');
    if (tooltipEl) tooltipEl.style.display = 'none';
  };

  window.showSegmentDetail = function(seg, index) {
    console.log(`分段 ${index + 1}:`, seg.title);
  };

  // Update insight footer
  const footerEl = document.getElementById('d1-insight-footer');
  if (footerEl) {
    const activeMetrics = Object.keys(d1ActiveMetrics).filter(m => d1ActiveMetrics[m]);
    const metricsNames = activeMetrics.map(m => metricConfig[m]?.name || m);

    footerEl.innerHTML = `Showing: ${metricsNames.join(', ')} over time. Total of ${timeline.length} data points, covering total film length of ${formatTime(timeline[timeline.length-1].time)}.`;
  }
}

// ═══════════════════════════════════════════
// D2: 色彩情绪放映机 (Color-Emotion Player)
// ═══════════════════════════════════════════

// ---- D2 Math Utils ----
function lerpD2(a, b, t) { return a + (b - a) * t; }
function lerpColorD2(c1, c2, t) {
  return [
    Math.round(lerpD2(c1[0], c2[0], t)),
    Math.round(lerpD2(c1[1], c2[1], t)),
    Math.round(lerpD2(c1[2], c2[2], t))
  ];
}
function formatTimeD2(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
}

// ---- D2 Particle Class ----
class D2Particle {
  constructor(cx, cy, orbR) {
    this.reset(cx, cy, orbR);
  }
  reset(cx, cy, orbR) {
    const angle = Math.random() * Math.PI * 2;
    const baseDist = orbR * (1.1 + Math.random() * 0.9);
    this.angle = angle;
    this.radius = baseDist;
    this.baseRadius = baseDist;
    this.x = cx + Math.cos(angle) * baseDist;
    this.y = cy + Math.sin(angle) * baseDist;
    this.size = 1.2 + Math.random() * 2.8;
    this.speed = 0.003 + Math.random() * 0.012;
    this.opacity = 0.3 + Math.random() * 0.5;
    this.phase = Math.random() * Math.PI * 2;
    this.colorShift = Math.random();
  }
  update(cx, cy, orbR, sentiment, density, time) {
    // 情绪驱动半径: 以中性环(orbR*2.0)为基准, 积极向外、消极向内
    const neutralR = orbR * 2.0;
    const sentimentOffset = sentiment * orbR * 1.6;
    const targetRadius = neutralR + sentimentOffset;
    this.radius = lerpD2(this.radius, targetRadius, 0.04);

    // 密度驱动粒子旋转速度
    const densityFactor = Math.min(density / 100, 2.0);
    const orbitSpeed = this.speed * (0.4 + densityFactor * 1.2);
    this.angle += orbitSpeed;

    this.x = cx + Math.cos(this.angle) * this.radius;
    this.y = cy + Math.sin(this.angle) * this.radius;

    // 密度越高粒子越大
    this.size = 1.5 + densityFactor * 1.5;
    this.opacity = 0.3 + densityFactor * 0.3;
    this.opacity = Math.min(0.85, Math.max(0.2, this.opacity));
  }
  draw(ctx) {
    // 粒子为白色, 代表语言/对白
    const a = this.opacity;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fill();
  }
}

// ---- D2: Init Particles ----
function initD2Particles(count = 90) {
  const { cx, cy, orbRadius } = d2State;
  d2State.particles = [];
  for (let i = 0; i < count; i++) {
    d2State.particles.push(new D2Particle(cx, cy, orbRadius));
  }
}

// ---- D2: Resize Canvas ----
function resizeD2Canvas() {
  const canvas = d2State.canvas;
  if (!canvas) return;
  const wrapper = canvas.parentElement;
  const rect = wrapper.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = rect.width;
  const h = rect.height;
  d2State.dpr = dpr;
  d2State.width = w;
  d2State.height = h;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  d2State.ctx = canvas.getContext('2d');
  d2State.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  d2State.cx = w / 2;
  d2State.cy = h / 2;
  d2State.orbRadius = Math.min(w, h) * 0.18;
}

// ---- D2: Draw Background ----
function drawD2Background() {
  const { ctx, width, height, currentColor } = d2State;
  // Dark radial gradient from orb color
  const grad = ctx.createRadialGradient(
    d2State.cx, d2State.cy, d2State.orbRadius * 0.5,
    d2State.cx, d2State.cy, Math.max(width, height) * 0.9
  );
  const r = currentColor[0], g = currentColor[1], b = currentColor[2];
  grad.addColorStop(0, `rgba(${r},${g},${b},0.12)`);
  grad.addColorStop(0.4, `rgba(${Math.round(r*0.4)},${Math.round(g*0.4)},${Math.round(b*0.4)},0.06)`);
  grad.addColorStop(1, 'rgba(0,0,0,0.95)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

// ---- D2: Draw Central Orb (色彩光球, 简洁版) ----
function drawD2Orb() {
  const { ctx, cx, cy, orbRadius, currentColor } = d2State;
  const r = currentColor[0], g = currentColor[1], b = currentColor[2];
  const rEff = orbRadius;

  // Outer glow
  const glowGrad = ctx.createRadialGradient(cx, cy, rEff * 0.7, cx, cy, rEff * 2.0);
  glowGrad.addColorStop(0, `rgba(${r},${g},${b},0.18)`);
  glowGrad.addColorStop(0.5, `rgba(${r},${g},${b},0.06)`);
  glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glowGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, rEff * 2.0, 0, Math.PI * 2);
  ctx.fill();

  // Core orb
  const coreGrad = ctx.createRadialGradient(cx - rEff*0.15, cy - rEff*0.2, rEff*0.05, cx, cy, rEff);
  coreGrad.addColorStop(0, `rgba(${Math.min(255,r+80)},${Math.min(255,g+80)},${Math.min(255,b+80)},0.95)`);
  coreGrad.addColorStop(0.6, `rgba(${r},${g},${b},0.9)`);
  coreGrad.addColorStop(1, `rgba(${Math.round(r*0.5)},${Math.round(g*0.5)},${Math.round(b*0.5)},0.6)`);
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, rEff, 0, Math.PI * 2);
  ctx.fill();

  // Specular highlight
  const specGrad = ctx.createRadialGradient(cx - rEff*0.25, cy - rEff*0.3, 0, cx - rEff*0.2, cy - rEff*0.2, rEff*0.5);
  specGrad.addColorStop(0, 'rgba(255,255,255,0.3)');
  specGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = specGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, rEff, 0, Math.PI * 2);
  ctx.fill();
}

// ---- D2: Draw Neutral Ring (中性情绪参考环) ----
function drawD2NeutralRing() {
  const { ctx, cx, cy, orbRadius } = d2State;
  const ringR = orbRadius * 2.0;

  ctx.beginPath();
  ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ---- D2: Draw Particles ----
function drawD2Particles() {
  const { ctx, cx, cy, orbRadius, particles, currentSentiment, currentDensity, currentColor } = d2State;
  const now = performance.now() / 1000;
  for (const p of particles) {
    p.update(cx, cy, orbRadius, currentSentiment, currentDensity, now);
    p.draw(ctx);
  }
}

// ---- D2: Main Render Frame ----
function renderD2Frame(timestamp) {
  if (!d2State.ctx) return;

  const { ctx, width, height, timeline, currentTime, totalDuration } = d2State;

  // Clear
  ctx.clearRect(0, 0, width, height);

  // Draw layers: 背景 → 中性环 → 粒子 → 光球
  drawD2Background();
  drawD2NeutralRing();
  drawD2Particles();
  drawD2Orb();

  // Update current data from timeline
  if (timeline.length > 0) {
    const idx = findTimelineIndex(currentTime);
    const pt = timeline[idx];
    if (pt) {
      d2State.targetColor = pt.barcode_color || [128,128,128];
      d2State.currentSentiment = pt.sentiment || 0;
      d2State.currentDensity = pt.density || 0;
    }
  }

  // Smooth color transition
  d2State.currentColor = lerpColorD2(d2State.currentColor, d2State.targetColor, 0.15);
}

// ---- D2: Find Timeline Index ----
function findTimelineIndex(time) {
  const tl = d2State.timeline;
  if (!tl.length) return 0;
  let lo = 0, hi = tl.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (tl[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ---- D2: Update Segment Info Overlay ----
function updateD2SegmentInfo() {
  const { segments, currentTime, lastSegmentTitle } = d2State;
  const titleEl = document.getElementById('d2-segment-title');
  const summaryEl = document.getElementById('d2-segment-summary');
  const overlayEl = document.getElementById('d2-segment-overlay');
  if (!titleEl || !summaryEl || !overlayEl) return;

  let currentSeg = null;
  for (const seg of segments) {
    if (currentTime >= seg.start_time && currentTime < seg.end_time) {
      currentSeg = seg;
      break;
    }
  }

  if (currentSeg) {
    const segTitle = currentSeg.title || '';
    if (segTitle !== lastSegmentTitle) {
      d2State.lastSegmentTitle = segTitle;
      // Fade out then in
      overlayEl.style.opacity = '0';
      setTimeout(() => {
        titleEl.textContent = segTitle;
        summaryEl.textContent = currentSeg.summary || '';
        overlayEl.style.opacity = '1';
      }, 300);
    }
  } else {
    d2State.lastSegmentTitle = '';
    overlayEl.style.opacity = '0';
  }
}

// ---- D2: Update Time Display ----
function updateD2TimeDisplay() {
  const el = document.getElementById('d2-time-display');
  if (!el) return;
  el.textContent = `${formatTimeD2(d2State.currentTime)} / ${formatTimeD2(d2State.totalDuration)}`;
}

// ---- D2: Update Emotion Indicator ----
function updateD2EmotionIndicator() {
  const el = document.getElementById('d2-emotion-value');
  if (!el) return;
  const s = d2State.currentSentiment;
  const val = s.toFixed(2);
  el.textContent = val;
  // Color: green for positive, red for negative, grey for neutral
  if (s > 0.15) el.style.color = '#5eead4';
  else if (s < -0.15) el.style.color = '#ff6b6b';
  else el.style.color = '#888';
}

// ---- D2: Update Density Display ----
function updateD2DensityDisplay() {
  const barEl = document.getElementById('d2-density-bar');
  const textEl = document.getElementById('d2-density-text');
  if (!barEl || !textEl) return;

  const d = d2State.currentDensity;
  // Dialogue density text description: Sparse, Normal, Active, Dense
  let label, pct;
  if (d < 20) { label = 'Sparse'; pct = Math.max(5, d / 20 * 20); }
  else if (d < 50) { label = 'Normal'; pct = 20 + (d - 20) / 30 * 35; }
  else if (d < 80) { label = 'Active'; pct = 55 + (d - 50) / 30 * 30; }
  else { label = 'Dense'; pct = 85 + Math.min((d - 80) / 40 * 15, 15); }

  barEl.style.width = `${Math.min(100, pct)}%`;
  textEl.textContent = label;

  // 文字颜色随密度变化
  if (d > 70) textEl.style.color = '#ff7a46';
  else if (d > 35) textEl.style.color = '#fadb14';
  else textEl.style.color = '#5eead4';
}

// ---- D2: Draw Mini Barcode ----
function drawMiniBarcode() {
  const { miniCanvas, miniCtx, timeline, totalDuration } = d2State;
  if (!miniCanvas || !miniCtx || !timeline.length) return;

  const w = miniCanvas.width;
  const h = miniCanvas.height;
  miniCtx.clearRect(0, 0, w, h);

  const barWidth = Math.max(w / timeline.length, 1);
  for (let i = 0; i < timeline.length; i++) {
    const color = timeline[i].barcode_color || [128,128,128];
    const x = (timeline[i].time / totalDuration) * w;
    miniCtx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
    miniCtx.fillRect(x, 0, Math.ceil(barWidth), h);
  }

  // Segment dividers
  const { segments } = d2State;
  for (const seg of segments) {
    if (seg.start_time > 0) {
      const sx = (seg.start_time / totalDuration) * w;
      miniCtx.strokeStyle = 'rgba(255,255,255,0.3)';
      miniCtx.lineWidth = 1;
      miniCtx.beginPath();
      miniCtx.moveTo(sx, 0);
      miniCtx.lineTo(sx, h);
      miniCtx.stroke();
    }
  }

  d2State.miniBarcodeDrawn = true;
}

// ---- D2: Update Scrubber ----
function updateD2Scrubber() {
  const scrubber = document.getElementById('d2-scrubber');
  if (!scrubber || !d2State.totalDuration) return;
  const pct = (d2State.currentTime / d2State.totalDuration) * 100;
  scrubber.style.left = `${Math.min(100, Math.max(0, pct))}%`;
}

// ---- D2: Update All UI ----
function updateD2UI() {
  updateD2TimeDisplay();
  updateD2EmotionIndicator();
  updateD2DensityDisplay();
  updateD2SegmentInfo();
  updateD2Scrubber();
}

// ---- D2: Animation Loop (with time advancement) ----
let d2LastFrameTs = 0;
function d2AnimationLoop(timestamp) {
  if (!d2State.isPlaying) {
    d2State.animFrameId = null;
    return;
  }

  // Calculate delta time
  if (d2LastFrameTs === 0) d2LastFrameTs = timestamp;
  let dt = (timestamp - d2LastFrameTs) / 1000; // seconds
  d2LastFrameTs = timestamp;

  // Clamp dt to avoid huge jumps
  if (dt > 0.2) dt = 0.2;

  // Advance time
  d2State.currentTime += dt * d2State.speed;
  if (d2State.currentTime >= d2State.totalDuration) {
    d2State.currentTime = d2State.totalDuration;
    pauseD2Player();
  }

  // Render frame
  renderD2Frame(timestamp);
  updateD2UI();
  drawMiniBarcode();

  // Continue
  d2State.animFrameId = requestAnimationFrame(d2AnimationLoop);
}

// ---- D2: Play ----
function playD2Player() {
  if (!d2State.timeline.length) return;
  if (d2State.currentTime >= d2State.totalDuration) {
    d2State.currentTime = 0;
  }
  d2State.isPlaying = true;
  d2LastFrameTs = 0;
  d2State.animFrameId = requestAnimationFrame(d2AnimationLoop);

  // Update button
  const btn = document.getElementById('d2-btn-play');
  if (btn) {
    btn.classList.add('d2-btn--playing');
    btn.querySelector('.d2-btn-icon').textContent = '⏸';
  }
}

// ---- D2: Pause ----
function pauseD2Player() {
  d2State.isPlaying = false;
  if (d2State.animFrameId) {
    cancelAnimationFrame(d2State.animFrameId);
    d2State.animFrameId = null;
  }
  const btn = document.getElementById('d2-btn-play');
  if (btn) {
    btn.classList.remove('d2-btn--playing');
    btn.querySelector('.d2-btn-icon').textContent = '▶';
  }
}

// ---- D2: Seek ----
function seekD2Player(time) {
  d2State.currentTime = Math.max(0, Math.min(time, d2State.totalDuration));
  d2State.currentColor = [...d2State.targetColor];
  // Force one render
  if (d2State.ctx) {
    renderD2Frame(performance.now());
  }
  updateD2UI();
  updateD2Scrubber();
}

// ---- D2: Load Movie Data ----
async function loadD2MovieData(movieId) {
  // Reuse D1 cache
  if (d1CachedMovies[movieId]) return d1CachedMovies[movieId];
  try {
    const res = await fetch(`assets/data/${movieId}.json`);
    if (!res.ok) throw new Error("JSON not found");
    const data = await res.json();
    d1CachedMovies[movieId] = data;
    return data;
  } catch (e) {
    console.error("Failed to load D2 movie data:", movieId, e);
    return null;
  }
}

// ---- D2: Initialize Player with Movie ----
async function initD2WithMovie(movieId) {
  pauseD2Player();

  const data = await loadD2MovieData(movieId);
  if (!data) return;

  d2State.movieData = data;
  d2State.timeline = data.timeline || [];
  d2State.segments = data.segments || [];
  d2State.totalDuration = data.duration_seconds || (d2State.timeline.length > 0 ? d2State.timeline[d2State.timeline.length-1].time : 0);
  d2State.currentTime = 0;
  d2State.currentColor = d2State.timeline.length > 0 ? [...d2State.timeline[0].barcode_color] : [128,128,128];
  d2State.targetColor = [...d2State.currentColor];
  d2State.currentSentiment = 0;
  d2State.currentDensity = 0;
  d2State.currentSegmentIdx = -1;
  d2State.lastSegmentTitle = '';
  d2State.miniBarcodeDrawn = false;

  // Hide segment overlay
  const overlayEl = document.getElementById('d2-segment-overlay');
  if (overlayEl) overlayEl.style.opacity = '0';

  // Resize & init
  resizeD2Canvas();
  initD2Particles(90);

  // Draw mini barcode
  const miniCanvas = document.getElementById('d2-mini-barcode');
  if (miniCanvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = miniCanvas.parentElement.getBoundingClientRect();
    miniCanvas.width = rect.width * dpr;
    miniCanvas.height = rect.height * dpr;
    miniCanvas.style.width = rect.width + 'px';
    miniCanvas.style.height = rect.height + 'px';
    d2State.miniCanvas = miniCanvas;
    d2State.miniCtx = miniCanvas.getContext('2d');
    d2State.miniCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  drawMiniBarcode();

  // Render initial frame
  if (d2State.ctx) {
    renderD2Frame(performance.now());
  }
  updateD2UI();

  // Update footer
  const footerEl = document.getElementById('d2-insight-footer');
  if (footerEl) {
    footerEl.innerHTML = `Now Playing: <strong>${data.title}</strong> (${data.year}) · ${d2State.timeline.length} color moments · ${d2State.segments.length} segments · Total length ${formatTimeD2(d2State.totalDuration)}`;
  }
}

// ---- D2: Setup Player ----
async function setupD2Player() {
  const canvas = document.getElementById('d2-canvas');
  if (!canvas) return;
  d2State.canvas = canvas;

  // Play/Pause button
  const btnPlay = document.getElementById('d2-btn-play');
  if (btnPlay) {
    btnPlay.addEventListener('click', () => {
      if (d2State.isPlaying) {
        pauseD2Player();
      } else {
        playD2Player();
      }
    });
  }

  // Speed buttons
  const speedBtns = document.querySelectorAll('.d2-speed-btn');
  speedBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      speedBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      d2State.speed = parseFloat(btn.dataset.speed);
    });
  });

  // Mini barcode click to seek
  const miniWrapper = document.querySelector('.d2-mini-barcode-wrapper');
  if (miniWrapper) {
    miniWrapper.addEventListener('click', (e) => {
      const rect = miniWrapper.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = x / rect.width;
      seekD2Player(pct * d2State.totalDuration);
    });
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && document.activeElement === document.body) {
      e.preventDefault();
      if (d2State.isPlaying) pauseD2Player();
      else playD2Player();
    }
  });

  // Resize
  window.addEventListener('resize', () => {
    resizeD2Canvas();
    initD2Particles(90);
    if (!d2State.isPlaying && d2State.ctx) {
      renderD2Frame(performance.now());
    }
    // Redraw mini barcode on resize
    const miniCanvas = document.getElementById('d2-mini-barcode');
    if (miniCanvas && d2State.timeline.length) {
      const dpr = window.devicePixelRatio || 1;
      const rect = miniCanvas.parentElement.getBoundingClientRect();
      miniCanvas.width = rect.width * dpr;
      miniCanvas.height = rect.height * dpr;
      miniCanvas.style.width = rect.width + 'px';
      miniCanvas.style.height = rect.height + 'px';
      d2State.miniCtx = miniCanvas.getContext('2d');
      d2State.miniCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawMiniBarcode();
    }
  });

  // Fetch CSV and manifest for movie list
  try {
    const [csvRes, manifestRes] = await Promise.all([
      fetch('assets/master_tiered_movies_view.csv'),
      fetch('assets/data/manifest.json')
    ]);
    const csvText = await csvRes.text();
    const manifestIds = await manifestRes.json();
    const csvMovies = parseCSV(csvText);
    const processedMovies = csvMovies.filter(m => manifestIds.includes(m.IMDb_ID));
    processedMovies.sort((a, b) => a.Title.localeCompare(b.Title));

    const d2SelectEl = document.getElementById('d2-movie-select');
    if (d2SelectEl) {
      populateD1MovieSelect(d2SelectEl, processedMovies, 'tt0133093');
      d2SelectEl.addEventListener('change', async (e) => {
        await initD2WithMovie(e.target.value);
      });
    }

    // Load default movie
    await initD2WithMovie('tt0133093');

    console.log('✅ [D2] 色彩情绪放映机初始化完成');
  } catch (err) {
    console.error('❌ [D2] 初始化失败:', err);
  }
}

// Loader helper for ECharts
async function loadECharts() {
  if (window.echarts) return;
  return new Promise(resolve => {
    const script = document.createElement('script');
    script.src = "https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js";
    script.onload = resolve;
    document.head.appendChild(script);
  });
}

export async function initReinterpretSection() {
  await loadECharts();

  // Load movie names mapping first
  await loadD1MovieNamesMapping();

  const d1Container = document.querySelector('[data-chart="single-film"]');
  
  if (d1Container) {
    try {
      // Initialize ECharts instance for D1
      d1Chart = echarts.init(d1Container);

      // Fetch CSV and manifest
      const [csvRes, manifestRes] = await Promise.all([
        fetch('assets/master_tiered_movies_view.csv'),
        fetch('assets/data/manifest.json')
      ]);

      const csvText = await csvRes.text();
      const manifestIds = await manifestRes.json();

      // Parse and filter movies
      const csvMovies = parseCSV(csvText);
      const processedMovies = csvMovies.filter(m => manifestIds.includes(m.IMDb_ID));
      
      // Sort movies alphabetically by title
      processedMovies.sort((a, b) => a.Title.localeCompare(b.Title));

      // Setup D1 movie select dropdown
      const d1SelectEl = document.getElementById('d1-movie-select');
      if (d1SelectEl) {
        populateD1MovieSelect(d1SelectEl, processedMovies, d1CurrentMovieId);
        d1SelectEl.addEventListener('change', async (e) => {
          await selectD1Movie(e.target.value);
        });
      }

      // Setup D1 metric toggles
      setupD1MetricToggles();

      // Bind resize event
      window.addEventListener('resize', () => {
        if (d1Chart) d1Chart.resize();
      });

      // Load default D1 movie
      await selectD1Movie(d1CurrentMovieId);

      console.log('✅ [D1] 全景数据视图初始化完成');

    } catch (err) {
      console.error("❌ [D1] 初始化失败:", err);
    }
  }

  // Initialize D2: 色彩情绪放映机
  await setupD2Player();
}