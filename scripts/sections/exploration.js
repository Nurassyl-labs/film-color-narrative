const genreMap = {
  'Action': 'Action',
  'Animation': 'Animation',
  'Biography': 'Biography',
  'Comedy': 'Comedy',
  'Mystery': 'Mystery',
  'Romance': 'Romance',
  'Sci-Fi': 'Sci-Fi',
  'Horror': 'Horror'
};


// 存储全局处理后的数据
let movieData = [];
let genreColors = {}; 
let sortedGenres = [];

export async function initExploreSection() {
  await loadECharts();
  
  const stackContainer = document.querySelector('[data-chart="stacked-bars"]');
  const metricsContainer = document.querySelector('[data-chart="metrics"]');

  if (!stackContainer || !metricsContainer) return;

  const stackChart = echarts.init(stackContainer);
  const metricsChart = echarts.init(metricsContainer);

  try {
    const loadingEl = document.getElementById('stack-loading');
    if (loadingEl) loadingEl.style.display = 'block';

    // 1. 加载并处理数据
    await fetchDataAndProcessBarcodes();

    if (loadingEl) loadingEl.style.display = 'none';

    // 2. 初始渲染
    renderStackChart(stackChart, 'brightness');
    renderMetricsChart(metricsChart, 'brightness');

    // 3. 绑定 B1 (Stack Chart) 按钮 - 支持模式切换
    let currentMode = 'metric';
    let currentSortType = 'brightness';
    
    // 绑定模式切换按钮
    document.querySelectorAll('#stack-controls .mode-btn').forEach(btn => {
      btn.onclick = (e) => {
        document.querySelectorAll('#stack-controls .mode-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentMode = e.target.dataset.mode;
        
        // 切换显示的排序按钮组
        const metricGroup = document.getElementById('metric-sort-group');
        const originalGroup = document.getElementById('original-sort-group');
        
        if (currentMode === 'metric') {
          metricGroup.style.display = '';
          originalGroup.style.display = 'none';
          renderStackChart(stackChart, currentSortType);
        } else {
          metricGroup.style.display = 'none';
          originalGroup.style.display = '';
          renderOriginalColorStackChart(stackChart, currentSortType);
        }
        
        // 更新提示文字
        const insightEl = document.getElementById('stack-insight');
        if (insightEl) {
          if (currentMode === 'metric') {
            insightEl.textContent = 'Metric Mode: View the proportion distribution of brightness, saturation, and hue across genres. Darker areas represent higher concentrations of color blocks in that range.';
          } else {
            insightEl.textContent = 'Original Color Mode: Display the actual color composition of each genre. Hover to see the RGB values and proportions of specific colors, sorted from bottom to top by the selected metric.';
          }
        }
      };
    });
    
    // 绑定指标排序按钮（两种模式共用）
    document.querySelectorAll('#stack-controls [data-sort]').forEach(btn => {
      btn.onclick = (e) => {
        const group = e.target.closest('.control-group');
        group.querySelectorAll('.explore-btn[data-sort]').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentSortType = e.target.dataset.sort;
        
        if (currentMode === 'metric') {
          renderStackChart(stackChart, currentSortType);
        } else {
          renderOriginalColorStackChart(stackChart, currentSortType);
        }
      };
    });

    // 4. 绑定 B2 (Metrics Chart) 按钮
    document.querySelectorAll('#metrics-controls .explore-btn').forEach(btn => {
      btn.onclick = (e) => {
        document.querySelectorAll('#metrics-controls .explore-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        renderMetricsChart(metricsChart, e.target.dataset.metric);
      };
    });

    window.addEventListener('resize', () => {
      stackChart.resize();
      metricsChart.resize();
    });

  } catch (err) {
    console.error("初始化失败:", err);
  }
}

async function fetchDataAndProcessBarcodes() {
  const response = await fetch('assets/master_tiered_movies_view.csv');
  const csvText = await response.text();
  
  const lines = csvText.split('\n').slice(1);
  const movies = lines.filter(l => l.trim()).map(line => {
    // 简单的CSV处理，注意处理带引号的逗号情况
    const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
    return { 
      id: cols[0], 
      genre: cols[25] ? cols[25].trim() : "Other" // Primary_Category
    };
  });

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  
  const uniqueGenres = [...new Set(movies.map(m => m.genre))];
  
  for (const genre of uniqueGenres) {
    const genreMovies = movies.filter(m => m.genre === genre).slice(0, 8); // 每类抽样8部
    genreColors[genre] = { h: [], s: [], l: [], diffs: [], rgbColors: [] };

    for (const movie of genreMovies) {
      await new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
          const sampleCount = 100;
          canvas.width = sampleCount;
          canvas.height = 1;
          ctx.drawImage(img, 0, 0, sampleCount, 1);
          const pixels = ctx.getImageData(0, 0, sampleCount, 1).data;
          
          let lastL = null;
          for (let i = 0; i < pixels.length; i += 4) {
            const [r, g, b] = [pixels[i], pixels[i+1], pixels[i+2]];
            const [h, s, l] = rgbToHsl(r, g, b);
            genreColors[genre].h.push(h * 360);
            genreColors[genre].s.push(s * 100);
            genreColors[genre].l.push(l * 100);
            
            // 保存原始RGB颜色（用于原色模式）
            genreColors[genre].rgbColors.push({ r, g, b, h: h * 360, s: s * 100, l: l * 100 });
            
            // 计算相邻像素色相差（用于色相跳跃度）
            if (lastL !== null) {
              const hueDiff = Math.abs(h * 360 - lastL);
              genreColors[genre].diffs.push(Math.min(hueDiff, 360 - hueDiff));
            }
            lastL = h * 360;
          }
          resolve();
        };
        img.onerror = resolve;
        img.src = `assets/barcodes/${movie.id}.png`;
      });
    }
  }
  // 关键修复：首字母排序
  sortedGenres = Object.keys(genreColors).sort();
}
function renderStackChart(chart, type) {
  let series = [];
  let colorPalette = [];
  let labels = [];

  if (type === 'brightness') {
    colorPalette = ['#1a1a1a', '#6b6b6b', '#e8e8e8'];
    labels = ['Dark (0-33%)', 'Medium (33-66%)', 'Bright (66-100%)'];
    
    const steps = [0, 33, 66, 100];
    series = labels.map((name, idx) => ({
      name, 
      type: 'line', 
      stack: 'total', 
      areaStyle: { opacity: 0.9 },
      smooth: true, 
      showSymbol: false,
      lineStyle: { width: 0.5, color: 'rgba(255,255,255,0.1)' },
      data: sortedGenres.map(g => {
        const vals = genreColors[g].l;
        const count = vals.filter(v => v >= steps[idx] && v < steps[idx+1]).length;
        return (count / vals.length * 100).toFixed(1);
      })
    }));
  } 
  else if (type === 'saturation') {
    colorPalette = ['#2c3e50', '#7f8c8d', '#f39c12'];
    labels = ['Low Saturation (0-33%)', 'Medium Saturation (33-66%)', 'High Saturation (66-100%)'];
    const steps = [0, 33, 66, 100];
    series = labels.map((name, idx) => ({
      name, type: 'line', stack: 'total', areaStyle: { opacity: 0.85 }, smooth: true, showSymbol: false,
      data: sortedGenres.map(g => {
        const vals = genreColors[g].s;
        const count = vals.filter(v => v >= steps[idx] && v < steps[idx+1]).length;
        return (count / vals.length * 100).toFixed(1);
      })
    }));
  } else if (type === 'hue') {
    colorPalette = ['#ff6b6b', '#2ed573', '#1e90ff'];
    labels = ['Warm (0-120°)', 'Neutral (120-240°)', 'Cool (240-360°)'];
    const ranges = [[0, 120], [120, 240], [240, 360]];
    series = labels.map((name, idx) => ({
      name, type: 'line', stack: 'total', areaStyle: { opacity: 0.85 }, smooth: true, showSymbol: false,
      data: sortedGenres.map(g => {
        const vals = genreColors[g].h;
        return (vals.filter(v => v >= ranges[idx][0] && v < ranges[idx][1]).length / vals.length * 100).toFixed(1);
      })
    }));
  }

  const chineseGenres = sortedGenres.map(g => genreMap[g] || g);

  chart.setOption({
    color: colorPalette,
    tooltip: { 
      trigger: 'axis', 
      backgroundColor: 'rgba(15,15,15,0.95)',
      borderColor: '#333',
      textStyle: { color: '#fff', fontSize: 12 },
      axisPointer: { lineStyle: { color: '#f3d987', width: 1 } },
      formatter: function(params) {
        let res = `<div style="font-weight:bold;margin-bottom:4px;">${params[0].name}</div>`;
        params.reverse().forEach(p => { // 反转显示顺序，使 Tip 顺序与图层高度对应
          res += `${p.marker} ${p.seriesName}: <span style="float:right;font-weight:bold;margin-left:20px;">${p.value}%</span><br/>`;
        });
        return res;
      }
    },
    legend: { 
      textStyle: { color: '#888' }, 
      bottom: 5, 
      data: labels,
      itemGap: 15,
      itemWidth: 10,
      itemHeight: 10
    },
    grid: { top: '8%', left: '3%', right: '3%', bottom: '15%', containLabel: true },
    xAxis: { 
      type: 'category', 
      boundaryGap: false, 
      data: chineseGenres, // English labels
      axisLabel: { color: '#888', fontSize: 11, interval: 0, rotate: 30 }, // Rotate labels slightly for English text
      axisLine: { lineStyle: { color: '#333' } } 
    },
    yAxis: { 
      type: 'value', 
      max: 100, 
      axisLabel: { formatter: '{value}%', color: '#666' }, 
      splitLine: { lineStyle: { color: '#1a1a1a' } } 
    },
    series: series
  }, true); // 必须为 true，防止图例残留
}

// ... 前面定义的 genreMap 和 fetchData 逻辑保持不变 ...

function renderMetricsChart(chart, type) {
  let data = [];
  let yName = '';
  let color = '#f3d987';
  let formulaText = '';
  let yMax = 100;
  let yAxisFormatter = '{value}%';
  let hueEntries = [];

  // 1. Prepare data and explanations by type
  if (type === 'brightness') {
    yName = 'Average Brightness';
    data = sortedGenres.map(g => (genreColors[g].l.reduce((a,b)=>a+b,0) / genreColors[g].l.length).toFixed(1));
    formulaText = "Extracts the Lightness (L) channel value from all sampled pixels and calculates their arithmetic mean. Higher values represent overall brighter frames.";
  } else if (type === 'saturation') {
    yName = 'Average Saturation';
    color = '#ffa502';
    data = sortedGenres.map(g => (genreColors[g].s.reduce((a,b)=>a+b,0) / genreColors[g].s.length).toFixed(1));
    formulaText = "Extracts the Saturation (S) channel value from all sampled pixels and calculates their percentage mean. Higher values represent more vivid and pure colors.";
  } else if (type === 'hue') {
    yName = 'Average Hue';
    hueEntries = sortedGenres.map(g => {
      const values = genreColors[g].h;
      const angle = calcCircularMeanHue(values);
      return {
        key: g,
        name: genreMap[g] || g,
        angle,
        valueText: `${angle.toFixed(1)}°`
      };
    });
    formulaText = "Computes the circular mean of Hue (H) channel values for all sampled pixels in the barcodes. Each pointer needle on the wheel represents a movie genre, indicating its average hue.";
  } else if (type === 'variance') {
    yName = 'Color Variance';
    color = '#ff4757';
    // Logic: calculate average difference between adjacent pixels
    data = sortedGenres.map(g => (genreColors[g].diffs.reduce((a,b)=>a+b,0) / genreColors[g].diffs.length).toFixed(1));
    formulaText = "Calculates the average absolute difference in Hue between adjacent sample points in the barcode. Higher values indicate more abrupt and dramatic color transitions across scenes.";
  }

  if (type !== 'hue') {
    yMax = calcDynamicAxisMax(data);
  }

  // 2. 更新横轴中文标签
  const chineseLabels = sortedGenres.map(g => genreMap[g] || g);

  removeHueWheelOverlay(chart.getDom());

  if (type === 'hue') {
    renderHueWheel(chart, hueEntries, formulaText);
    return;
  }

  // 3. 渲染图表
  chart.setOption({
    tooltip: { 
      trigger: 'axis', 
      axisPointer: { type: 'shadow' },
      backgroundColor: 'rgba(20,20,20,0.9)',
      textStyle: { color: '#fff' }
    },
    grid: { top: '12%', left: '4%', right: '4%', bottom: '10%', containLabel: true },
    xAxis: { 
      type: 'category', 
      data: chineseLabels, // English labels
      axisLabel: { color: '#888', fontSize: 11, interval: 0, rotate: 30 } 
    },
    yAxis: { 
      type: 'value', 
      name: yName, 
      nameTextStyle: { color: '#666' },
      max: yMax,
      axisLabel: { color: '#666', formatter: yAxisFormatter }, 
      splitLine: { lineStyle: { color: '#1a1a1a' } } 
    },
    series: [{
      data: data,
      type: 'bar',
      barWidth: '45%',
      itemStyle: { 
        color: color,
        borderRadius: [4, 4, 0, 0]
      }
    }]
  }, true);

  // 4. 更新下方的计算说明文字
  const formulaEl = document.getElementById('formula-text');
  if (formulaEl) {
    formulaEl.textContent = formulaText;
  }
}

function calcCircularMeanHue(values) {
  if (!values.length) return 0;
  const radians = values.map((v) => (v / 180) * Math.PI);
  const x = radians.reduce((sum, value) => sum + Math.cos(value), 0) / radians.length;
  const y = radians.reduce((sum, value) => sum + Math.sin(value), 0) / radians.length;
  let angle = Math.atan2(y, x) * 180 / Math.PI;
  if (angle < 0) angle += 360;
  return angle;
}

function calcDynamicAxisMax(values) {
  const numericValues = values.map((value) => Number.parseFloat(value)).filter((value) => Number.isFinite(value));
  if (!numericValues.length) return 1;
  const maxValue = Math.max(...numericValues);
  const padded = maxValue + Math.max(maxValue * 0.15, 5);
  return Math.ceil(padded / 5) * 5;
}

function renderHueWheel(chart, entries, formulaText) {
  const container = chart.getDom();
  removeHueWheelOverlay(container);
  container.classList.add('is-hue-wheel-mode');

  const sortedEntries = sortHueEntries(entries);
  const overlay = document.createElement('div');
  overlay.className = 'hue-wheel-overlay';

  const layout = document.createElement('div');
  layout.className = 'hue-wheel-layout';

  const stage = document.createElement('div');
  stage.className = 'hue-wheel-stage';

  const wheel = document.createElement('div');
  wheel.className = 'hue-wheel';

  const core = document.createElement('div');
  core.className = 'hue-wheel-core';
  wheel.appendChild(core);

  // 渲染指针和标签
  sortedEntries.forEach((entry) => {
    const pointer = document.createElement('div');
    pointer.className = 'hue-pointer';
    pointer.setAttribute('data-genre', entry.key);
    // 这里的角度计算
    pointer.style.setProperty('--angle', `${entry.angle - 90}deg`);
    const color = hueAngleToColor(entry.angle);
    pointer.style.setProperty('--pointer-color', color);

    // 1. 创建针头（视觉部分）
    const needle = document.createElement('div');
    needle.className = 'hue-pointer__needle';

    // 2. 创建标签（视觉部分）：改为"名称 角度"
    const label = document.createElement('div');
    label.className = 'hue-pointer__label';
    label.textContent = `${entry.name} ${entry.angle.toFixed(1)}°`; 
    label.style.setProperty('--angle', `${entry.angle - 90}deg`);

    // 3. 【核心改进】：直接在父级 pointer 上绑定事件
    // 只要鼠标在这个从圆心向外延伸的长条形热区内，就保持高亮
    pointer.onmouseenter = () => highlightGenre(entry.key, container);
    pointer.onmouseleave = () => clearHighlight(container);

    pointer.appendChild(needle);
    pointer.appendChild(label);
    wheel.appendChild(pointer);
  });

  stage.appendChild(wheel);

  // 渲染右侧图例（逻辑不变）
  const legend = document.createElement('div');
  legend.className = 'hue-legend';
  sortedEntries.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'hue-legend__item';
    item.setAttribute('data-genre', entry.key);

    const name = document.createElement('span');
    name.className = 'hue-legend__name';
    name.textContent = entry.name;

    const value = document.createElement('span');
    value.className = 'hue-legend__value';
    value.textContent = `${entry.angle.toFixed(1)}°`; // 统一单位
    value.style.color = hueAngleToColor(entry.angle);

    item.appendChild(name);
    item.appendChild(value);

    item.onmouseenter = () => highlightGenre(entry.key, container);
    item.onmouseleave = () => clearHighlight(container);

    legend.appendChild(item);
  });

  layout.appendChild(stage);
  layout.appendChild(legend);
  overlay.appendChild(layout);
  container.appendChild(overlay);

  const formulaEl = document.getElementById('formula-text');
  if (formulaEl) formulaEl.textContent = formulaText;
}

// 辅助函数：执行高亮
function highlightGenre(genreKey, container) {
  // 清除旧的高亮
  clearHighlight(container);
  
  // 高亮指针
  const pointer = container.querySelector(`.hue-pointer[data-genre="${genreKey}"]`);
  if (pointer) pointer.classList.add('is-active');
  
  // 高亮图例
  const legendItem = container.querySelector(`.hue-legend__item[data-genre="${genreKey}"]`);
  if (legendItem) legendItem.classList.add('is-active');
}

// 辅助函数：清除高亮
function clearHighlight(container) {
  container.querySelectorAll('.is-active').forEach(el => el.classList.remove('is-active'));
}


function sortHueEntries(entries) {
  return [...entries].sort((a, b) => {
    const aWrapped = a.angle >= 300;
    const bWrapped = b.angle >= 300;
    if (aWrapped !== bWrapped) {
      return aWrapped ? -1 : 1;
    }
    return a.angle - b.angle;
  });
}

function removeHueWheelOverlay(container) {
  const overlay = container.querySelector('.hue-wheel-overlay');
  if (overlay) {
    overlay.remove();
  }
  container.classList.remove('is-hue-wheel-mode');
}

function hueAngleToColor(angle) {
  const normalized = ((angle % 360) + 360) % 360;
  return `hsl(${normalized}, 90%, 65%)`;
}

// 基础颜色转换函数
function rgbToHsl(r, g, b) {
  r /= 255, g /= 255, b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; } 
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, l];
}

// ==================== 原色模式核心算法 ====================

function quantizeColors(colors, maxColors = 20) {
  if (!colors.length) return [];
  
  // 使用简化的中位切分法进行颜色量化
  let buckets = [{ colors: colors.slice(), depth: 0 }];
  
  while (buckets.length < maxColors) {
    // 找到像素数最多的桶进行分割
    let maxBucketIdx = 0;
    let maxSize = 0;
    
    buckets.forEach((bucket, idx) => {
      if (bucket.colors.length > maxSize) {
        maxSize = bucket.colors.length;
        maxBucketIdx = idx;
      }
    });
    
    if (maxSize <= 1) break;
    
    const bucket = buckets[maxBucketIdx];
    const channel = bucket.depth % 3; // 0=R, 1=G, 2=B
    
    bucket.colors.sort((a, b) => {
      const channels = ['r', 'g', 'b'];
      return a[channels[channel]] - b[channels[channel]];
    });
    
    const mid = Math.floor(bucket.colors.length / 2);
    
    buckets.splice(maxBucketIdx, 1, 
      { colors: bucket.colors.slice(0, mid), depth: bucket.depth + 1 },
      { colors: bucket.colors.slice(mid), depth: bucket.depth + 1 }
    );
  }
  
  // 计算每个桶的平均颜色和占比
  return buckets.map(bucket => {
    const total = bucket.colors.length;
    const avgR = Math.round(bucket.colors.reduce((sum, c) => sum + c.r, 0) / total);
    const avgG = Math.round(bucket.colors.reduce((sum, c) => sum + c.g, 0) / total);
    const avgB = Math.round(bucket.colors.reduce((sum, c) => sum + c.b, 0) / total);
    const [h, s, l] = rgbToHsl(avgR, avgG, avgB);
    
    return {
      color: { r: avgR, g: avgG, b: avgB },
      hex: `#${avgR.toString(16).padStart(2,'0')}${avgG.toString(16).padStart(2,'0')}${avgB.toString(16).padStart(2,'0')}`,
      count: total,
      percentage: 0,
      h: h * 360,
      s: s * 100,
      l: l * 100
    };
  });
}

function renderOriginalColorStackChart(chart, sortType) {
  const chineseGenres = sortedGenres.map(g => genreMap[g] || g);
  
  // 为每个类别生成量化的颜色数据
  const allGenreData = sortedGenres.map(genre => {
    const rawColors = genreColors[genre].rgbColors;
    const quantized = quantizeColors(rawColors, 25); // 每个类别量化为25种主色
    
    const total = quantized.reduce((sum, q) => sum + q.count, 0);
    quantized.forEach(q => {
      q.percentage = (q.count / total * 100).toFixed(2);
    });
    
    // 根据排序指标对颜色进行排序
    quantized.sort((a, b) => {
      if (sortType === 'brightness') return a.l - b.l;
      if (sortType === 'saturation') return a.s - b.s;
      if (sortType === 'hue') return a.h - b.h;
      return 0;
    });
    
    return {
      genre,
      chineseName: genreMap[genre] || genre,
      colors: quantized
    };
  });
  
  // 构建series数据 - 每个系列代表一个颜色位置（从下到上）
  const maxColorCount = Math.max(...allGenreData.map(g => g.colors.length));
  const series = [];
  
  for (let i = 0; i < maxColorCount; i++) {
    series.push({
      name: `Color Band ${i + 1}`,
      type: 'bar',
      stack: 'total',
      barWidth: '60%',
      itemStyle: {
        color: (params) => {
          const genreData = allGenreData[params.dataIndex];
          if (genreData && genreData.colors[i]) {
            return genreData.colors[i].hex;
          }
          return 'transparent';
        }
      },
      data: allGenreData.map(genreData => {
        if (genreData.colors[i]) {
          return parseFloat(genreData.colors[i].percentage);
        }
        return 0;
      }),
      tooltip: {
        formatter: (params) => {
          const genreData = allGenreData[params.dataIndex];
          if (genreData && genreData.colors[i]) {
            const colorInfo = genreData.colors[i];
            return `
              <div style="padding: 8px;">
                <div style="display:flex;align-items:center;margin-bottom:6px;">
                  <div style="width:24px;height:24px;background:${colorInfo.hex};border-radius:4px;margin-right:8px;border:1px solid #333;"></div>
                  <span style="font-weight:bold;">RGB(${colorInfo.color.r}, ${colorInfo.color.g}, ${colorInfo.color.b})</span>
                </div>
                <div>Share: ${colorInfo.percentage}%</div>
                <div>Brightness: ${colorInfo.l.toFixed(1)}% | Saturation: ${colorInfo.s.toFixed(1)}% | Hue: ${colorInfo.h.toFixed(1)}°</div>
              </div>
            `;
          }
          return '';
        }
      }
    });
  }
  
  chart.setOption({
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(15,15,15,0.95)',
      borderColor: '#333',
      textStyle: { color: '#fff', fontSize: 12 },
      extraCssText: 'max-width: 280px;'
    },
    legend: { show: false }, // 原色模式下隐藏图例，因为颜色太多
    grid: { top: '8%', left: '3%', right: '3%', bottom: '12%', containLabel: true },
    xAxis: {
      type: 'category',
      data: chineseGenres,
      axisLabel: { color: '#888', fontSize: 11, interval: 0, rotate: 30 },
      axisLine: { lineStyle: { color: '#333' } }
    },
    yAxis: {
      type: 'value',
      max: 100,
      axisLabel: { formatter: '{value}%', color: '#666' },
      splitLine: { lineStyle: { color: '#1a1a1a' } }
    },
    series: series
  }, true);
}

async function loadECharts() {
  if (window.echarts) return;
  return new Promise(resolve => {
    const script = document.createElement('script');
    script.src = "https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js";
    script.onload = resolve;
    document.head.appendChild(script);
  });
}