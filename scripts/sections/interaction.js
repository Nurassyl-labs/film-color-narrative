let cachedMovies = {};
let currentMovieId = 'tt0133093'; // Default to The Matrix
let c2ViewMode = 'scatter'; // 'scatter' (相关性) or 'heatmap' (卡方检验)
let c2ActiveMetrics = { sentiment: true, density: false, brightness: true, saturation: false, hue: false };
let c1Chart = null;
let c2Chart = null;
let currentMovieData = null;

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
async function loadMovieData(movieId) {
  if (cachedMovies[movieId]) return cachedMovies[movieId];
  try {
    const res = await fetch(`assets/data/${movieId}.json`);
    if (!res.ok) throw new Error("JSON not found");
    const data = await res.json();
    cachedMovies[movieId] = data;
    return data;
  } catch (e) {
    console.error("Failed to load movie JSON data for", movieId, e);
    return null;
  }
}

// Initializer
export async function initInteractionSection() {
  await loadECharts();

  // Load movie names mapping first
  await loadMovieNamesMapping();

  const c1Container = document.querySelector('[data-chart="story-segments"]');
  const c2Container = document.querySelector('[data-chart="emotion-sync"]');

  if (!c1Container || !c2Container) return;

  // Initialize ECharts instances
  c1Chart = echarts.init(c1Container);
  c2Chart = echarts.init(c2Container);

  try {
    // 1. Fetch CSV and manifest
    const [csvRes, manifestRes] = await Promise.all([
      fetch('assets/master_tiered_movies_view.csv'),
      fetch('assets/data/manifest.json')
    ]);

    const csvText = await csvRes.text();
    const csvMovies = parseCSV(csvText);
    const manifestIds = await manifestRes.json();

    // Filter CSV movies to include only processed ones
    const processedMovies = csvMovies.filter(m => manifestIds.includes(m.IMDb_ID));
    
    // Sort movies alphabetically by title
    processedMovies.sort((a, b) => a.Title.localeCompare(b.Title));

    // 2. Populate dropdown selector
    const selectEl = document.getElementById('interaction-movie-select');
    const c2SelectEl = document.getElementById('c2-movie-select');
    
    if (selectEl) {
      populateMovieSelect(selectEl, processedMovies, currentMovieId);
      // Bind dropdown change event
      selectEl.onchange = (e) => selectMovie(e.target.value);
    }

    // 3. Bind C2 metric toggles with single selection per group
    document.querySelectorAll('#c2-toggles .toggle-btn input').forEach(input => {
      input.onchange = (e) => {
        const btn = e.target.closest('.toggle-btn');
        const metric = btn.dataset.metric;
        const type = btn.dataset.type; // 'subtitle' or 'color'

        // 检查是否要取消选择（不允许全部不选）
        if (!e.target.checked) {
          const sameTypeBtns = Array.from(document.querySelectorAll(`#c2-toggles .toggle-btn[data-type="${type}"]`));
          const activeCount = sameTypeBtns.filter(b => b.querySelector('input').checked).length;

          if (activeCount <= 1) {
            e.target.checked = true; // 阻止取消
            return;
          }
        }

        // If enabling this metric, disable others in the same group (单选逻辑)
        if (e.target.checked) {
          document.querySelectorAll(`#c2-toggles .toggle-btn[data-type="${type}"]`).forEach(otherBtn => {
            if (otherBtn !== btn) {
              otherBtn.querySelector('input').checked = false;
              otherBtn.classList.remove('active');
              c2ActiveMetrics[otherBtn.dataset.metric] = false;
            }
          });
        }

        c2ActiveMetrics[metric] = e.target.checked;
        btn.classList.toggle('active', e.target.checked);

        // Re-render C2 with all movies data (no single movie needed)
        renderC2();
      };
    });

    // 3.5 Bind C2 mode switch (scatter vs heatmap)
    document.querySelectorAll('#c2-mode-switch .toggle-btn').forEach(btn => {
      btn.querySelector('input').onchange = (e) => {
        if (e.target.checked) {
          // Update active state
          document.querySelectorAll('#c2-mode-switch .toggle-btn').forEach(b => {
            b.classList.remove('active');
          });
          btn.classList.add('active');

          // Update mode
          c2ViewMode = btn.dataset.mode;

          // Toggle legend visibility
          const scatterLegend = document.getElementById('scatter-legend');
          const heatmapLegend = document.getElementById('heatmap-legend');
          const statLabel = document.getElementById('stat-label');

          if (scatterLegend && heatmapLegend) {
            if (c2ViewMode === 'scatter') {
              scatterLegend.style.display = 'block';
              heatmapLegend.style.display = 'none';
              if (statLabel) statLabel.textContent = 'Correlation Coefficient (r): ';
            } else {
              scatterLegend.style.display = 'none';
              heatmapLegend.style.display = 'block';
              if (statLabel) statLabel.textContent = 'Chi-Squared (χ²): ';
            }
          }

          // Re-render with new mode
          renderC2();
        }
      };
    });

    // 4. Bind resize event
    window.addEventListener('resize', () => {
      if (c1Chart) c1Chart.resize();
      if (c2Chart) c2Chart.resize();
    });

    // 5. Initial render for C1 and C2
    await selectMovie(currentMovieId);
    // C2 now shows all movies by default (no single movie selection needed)
    await renderC2();

  } catch (err) {
    console.error("Initialization of Part C failed:", err);
  }
}

// Movie Chinese name translation map (loaded from external JSON)
let movieChineseNames = {};

// Load movie names mapping from external file
async function loadMovieNamesMapping() {
  try {
    const response = await fetch('assets/data/movie-names-mapping.json');
    const data = await response.json();
    movieChineseNames = data.mapping || {};
    console.log(`✅ Loaded ${Object.keys(movieChineseNames).length} movie name mappings`);
  } catch (error) {
    console.error('❌ Failed to load movie name mapping:', error);
  }
}

// Helper function to get movie name
function getChineseName(englishTitle) {
  return englishTitle;
}

// Helper function to populate movie select dropdown
function populateMovieSelect(selectEl, movies, currentId) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  movies.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.IMDb_ID;
    opt.innerText = `${m.Title} (${m.Year})`;
    if (m.IMDb_ID === currentId) opt.selected = true;
    selectEl.appendChild(opt);
  });
}

// Select movie and trigger redraws (for C1 only)
async function selectMovie(movieId) {
  currentMovieId = movieId;
  
  // Update select element value
  const selectEl = document.getElementById('interaction-movie-select');
  if (selectEl) selectEl.value = movieId;

  // Show loading indicator
  const c1Loader = document.getElementById('c1-loading');
  if (c1Loader) c1Loader.style.display = 'block';

  // Load JSON
  const data = await loadMovieData(movieId);
  currentMovieData = data;

  if (c1Loader) c1Loader.style.display = 'none';

  if (!data) return;

  // Render movie card metadata
  updateMovieMetadata(data);

  // Render C1 chart only (C2 is now independent)
  renderC1(data);
}

// Update left sidebar metadata card
function updateMovieMetadata(data) {
  const posterEl = document.getElementById('c1-poster');
  const titleEl = document.getElementById('c1-title');
  const yearEl = document.getElementById('c1-year');
  const genreEl = document.getElementById('c1-genre');
  const durationEl = document.getElementById('c1-duration');
  const ratingEl = document.getElementById('c1-rating');

  if (posterEl) {
    posterEl.src = data.poster || 'assets/posters/placeholder.jpg';
    posterEl.onerror = () => {
      posterEl.src = 'https://m.media-amazon.com/images/M/MV5BMTMxNTMwODM0NF5BMl5BanBnXkFtZTcwODAyMTk2Mw@@._V1_QL75_UX380_CR0,0,380,562_.jpg'; // Fallback to Dark Knight
    };
  }
  
  // Show Chinese + English title
  const chineseName = getChineseName(data.title);
  if (titleEl) titleEl.innerText = `${chineseName}\n${data.title}`;
  
  if (yearEl) yearEl.innerText = data.year;
  if (genreEl) genreEl.innerText = data.genre;
  if (durationEl) durationEl.innerText = `${Math.round(data.duration_seconds / 60)} min`;
  if (ratingEl) ratingEl.innerText = data.rating;
}

// C1: Render Story Segments (Chapters) Bar Chart
function renderC1(data) {
  if (!c1Chart) return;

  const segments = data.segments;
  const totalDuration = data.duration_seconds;
  
  // 计算segments的实际时间范围，并归一化到电影总时长
  const firstStart = Math.min(...segments.map(s => s.start_time));
  const lastEnd = Math.max(...segments.map(s => s.end_time));
  const segmentDuration = lastEnd - firstStart;
  
  // 如果segments没有覆盖完整电影时长，进行归一化处理
  let normalizedSegments = segments;
  if (segmentDuration < totalDuration * 0.9 || firstStart > 60) {
    // 将segments的时间映射到[0, totalDuration]区间
    normalizedSegments = segments.map((seg, idx) => {
      const originalDuration = seg.end_time - seg.start_time;
      // 保持每个segment的相对时长比例
      const normalizedDuration = (originalDuration / segmentDuration) * totalDuration;
      // 计算归一化的起始位置
      const normalizedStart = ((seg.start_time - firstStart) / segmentDuration) * totalDuration;
      
      return {
        ...seg,
        start_time: normalizedStart,
        end_time: normalizedStart + normalizedDuration
      };
    });
  }
  
  // Series data represents individual segments stacked together
  const series = normalizedSegments.map((seg, idx) => ({
    name: seg.title,
    type: 'bar',
    stack: 'total',
    data: [seg.end_time - seg.start_time],
    itemStyle: {
      color: `rgb(${seg.avg_color.join(',')})`,
      borderRadius: segments.length === 1 ? [4, 4, 4, 4] : 
                   idx === 0 ? [6, 0, 0, 6] : 
                   idx === segments.length - 1 ? [0, 6, 6, 0] : 0,
      borderColor: 'rgba(11, 12, 16, 0.9)',
      borderWidth: 1.5
    },
    emphasis: {
      itemStyle: {
        shadowBlur: 20,
        shadowColor: 'rgba(255,255,255,0.7)',
        borderColor: '#fff',
        borderWidth: 2
      }
    }
  }));

  c1Chart.setOption({
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(15,15,20,0.95)',
      borderColor: '#333',
      borderWidth: 1,
      textStyle: { color: '#fff', fontSize: 13 },
      formatter: function (params) {
        const seg = segments[params.seriesIndex];
        return `
          <div style="font-weight:bold;color:var(--fc-accent-cool);margin-bottom:6px;">${seg.title}</div>
          <div style="font-size:12px;margin-bottom:4px;color:#aaa;">Time: ${formatTime(seg.start_time)} - ${formatTime(seg.end_time)}</div>
          <div style="font-size:12px;margin-bottom:6px;max-width:280px;white-space:normal;line-height:1.4;">${seg.summary}</div>
          <div style="display:flex;gap:12px;border-top:1px solid #333;padding-top:6px;font-size:11px;color:#888;">
            <span>Sentiment: <strong style="color:#fff;">${seg.avg_sentiment > 0.1 ? 'Positive' : seg.avg_sentiment < -0.1 ? 'Negative' : 'Neutral'}</strong></span>
            <span>Dialogue: <strong style="color:#fff;">${Math.round(seg.dialogue_density)} wpm</strong></span>
          </div>
        `;
      }
    },
    grid: {
      top: 20,
      bottom: 20,
      left: 10,
      right: 10,
      containLabel: false
    },
    xAxis: {
      type: 'value',
      max: data.duration_seconds,
      show: false
    },
    yAxis: {
      type: 'category',
      data: ['Plot Chapter'],
      show: false
    },
    series: series
  }, true);

  // Update detail card when hovering over chapters
  c1Chart.on('mouseover', (params) => {
    const seg = segments[params.seriesIndex];
    updateChapterPanel(seg);
  });

  // Default update to first chapter
  if (segments.length > 0) {
    updateChapterPanel(segments[0]);
  }
}

// Update the C1 Chapter Info Panel
function updateChapterPanel(seg) {
  const panel = document.getElementById('c1-chapter-panel');
  const colorIndicator = document.getElementById('c1-chapter-color');
  const titleEl = document.getElementById('c1-chapter-title');
  const timeEl = document.getElementById('c1-chapter-time');
  const summaryEl = document.getElementById('c1-chapter-summary');
  const densityEl = document.getElementById('c1-chapter-density');
  const sentimentEl = document.getElementById('c1-chapter-sentiment');
  const brightnessEl = document.getElementById('c1-chapter-brightness');

  if (!panel) return;

  // Slide-in fade effect animation
  panel.classList.remove('is-active');
  void panel.offsetWidth; // Trigger reflow
  panel.classList.add('is-active');

  if (colorIndicator) {
    colorIndicator.style.backgroundColor = `rgb(${seg.avg_color.join(',')})`;
    colorIndicator.style.boxShadow = `0 0 25px rgba(${seg.avg_color.join(',')}, 0.55)`;
  }
  if (titleEl) titleEl.innerText = seg.title;
  if (timeEl) timeEl.innerText = `${formatTime(seg.start_time)} - ${formatTime(seg.end_time)}`;
  if (summaryEl) summaryEl.innerText = seg.summary;
  if (densityEl) densityEl.innerText = `${Math.round(seg.dialogue_density)} wpm`;
  if (sentimentEl) {
    const scoreVal = seg.avg_sentiment;
    sentimentEl.innerText = `${scoreVal > 0 ? '+' : ''}${scoreVal.toFixed(2)}`;
    sentimentEl.style.color = scoreVal > 0.05 ? 'var(--fc-accent-cool)' : scoreVal < -0.05 ? 'var(--fc-accent-strong)' : 'var(--fc-text-soft)';
  }
  
  // Approximate brightness value
  if (brightnessEl) {
    // Lightness HSL is mapped to brightness
    const timeline = currentMovieData.timeline;
    const segTimeline = timeline.filter(p => p.time >= seg.start_time && p.time < seg.end_time);
    const avgBrightness = segTimeline.length > 0 ? 
      segTimeline.reduce((sum, p) => sum + p.brightness, 0) / segTimeline.length : 50;
    brightnessEl.innerText = `${Math.round(avgBrightness)}%`;
  }
}

// C2: Render multi-track timeline with correlation display
// Now defaults to showing all movies' segments in scatter mode
async function renderC2(data = null) {
  if (!c2Chart) return;

  // 根据模式选择渲染方式
  if (c2ViewMode === 'scatter') {
    // 散点图模式：相关性分析
    await renderC2Scatter(data);
  } else if (c2ViewMode === 'heatmap') {
    // 热力图模式：卡方检验
    await renderC2Heatmap(data);
  }
}

// Render the Time-series dual axis chart with correlation display
function renderC2Timeline(data) {
  const timeline = data.timeline;
  
  const xAxisData = timeline.map(p => p.time);
  const series = [];
  const legendData = [];
  
  // Determine active subtitle and color metrics
  const subtitleMetric = c2ActiveMetrics.sentiment ? 'sentiment' : (c2ActiveMetrics.density ? 'density' : null);
  const colorMetric = c2ActiveMetrics.brightness ? 'brightness' : (c2ActiveMetrics.saturation ? 'saturation' : null);

  // 1. Subtitle metric series (left Y-axis)
  if (subtitleMetric === 'sentiment') {
    legendData.push('Dialogue Sentiment');
    series.push({
      name: 'Dialogue Sentiment',
      type: 'line',
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 1.5, color: '#5eead4' },
      areaStyle: {
        opacity: 0.28,
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(94, 234, 212, 0.5)' },
          { offset: 0.5, color: 'rgba(14, 15, 20, 0.05)' },
          { offset: 1, color: 'rgba(255, 56, 86, 0.5)' }
        ])
      },
      data: timeline.map(p => [p.time, p.sentiment])
    });
  } else if (subtitleMetric === 'density') {
    legendData.push('Dialogue Density');
    series.push({
      name: 'Dialogue Density',
      type: 'line',
      smooth: true,
      showSymbol: false,
      yAxisIndex: 0,
      lineStyle: { width: 1.5, type: 'dashed', color: '#ff7a46', opacity: 0.8 },
      data: timeline.map(p => [p.time, p.density])
    });
  }

  // 2. Color metric series (right Y-axis)
  if (colorMetric === 'brightness') {
    legendData.push('Scene Brightness');
    series.push({
      name: 'Scene Brightness',
      type: 'line',
      smooth: true,
      showSymbol: false,
      yAxisIndex: 1,
      lineStyle: { width: 1.2, color: '#fadb14', opacity: 0.9 },
      data: timeline.map(p => [p.time, p.brightness / 50 - 1])
    });
  } else if (colorMetric === 'saturation') {
    legendData.push('Scene Saturation');
    series.push({
      name: 'Scene Saturation',
      type: 'line',
      smooth: true,
      showSymbol: false,
      yAxisIndex: 1,
      lineStyle: { width: 1.2, color: '#c678dd', opacity: 0.9 },
      data: timeline.map(p => [p.time, p.saturation / 50 - 1])
    });
  }

  // Calculate and display correlation if both metrics are selected
  let correlationValue = null;
  if (subtitleMetric && colorMetric) {
    const subData = timeline.map(p => {
      return subtitleMetric === 'sentiment' ? p.sentiment : p.density;
    });
    const colData = timeline.map(p => {
      return colorMetric === 'brightness' ? p.brightness / 50 - 1 : p.saturation / 50 - 1;
    });
    
    correlationValue = calculateCorrelation(subData, colData);
    
    // Show correlation display
    const corrDisplay = document.getElementById('correlation-display');
    const corrValueEl = document.getElementById('correlation-value');
    if (corrDisplay && corrValueEl) {
      corrDisplay.style.display = 'flex';
      corrValueEl.textContent = correlationValue.toFixed(3);
      
      // Color code based on strength
      const absCorr = Math.abs(correlationValue);
      if (absCorr > 0.7) {
        corrValueEl.style.color = '#ff4757'; // Strong correlation - red
      } else if (absCorr > 0.3) {
        corrValueEl.style.color = '#ffa502'; // Medium correlation - orange
      } else {
        corrValueEl.style.color = '#2ed573'; // Weak correlation - green
      }
    }
  } else {
    // Hide correlation display
    const corrDisplay = document.getElementById('correlation-display');
    if (corrDisplay) corrDisplay.style.display = 'none';
  }

  // Determine axis labels based on selected metrics
  const leftAxisName = subtitleMetric === 'sentiment' ? 'Dialogue Sentiment Strength' : 
                       subtitleMetric === 'density' ? 'Dialogue Density (wpm)' : '';
  const rightAxisName = colorMetric === 'brightness' ? 'Scene Brightness (Normalized)' :
                        colorMetric === 'saturation' ? 'Scene Saturation (Normalized)' : '';

  c2Chart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', label: { show: false } },
      backgroundColor: 'rgba(15,15,20,0.95)',
      borderColor: '#333',
      textStyle: { color: '#fff' },
      formatter: function(params) {
        let result = `<div style="font-weight:bold;margin-bottom:8px;">${formatTime(params[0].value[0])}</div>`;
        params.forEach(param => {
          result += `${param.marker} ${param.seriesName}: <strong>${param.value[1].toFixed(3)}</strong><br/>`;
        });
        
        // Add correlation info to tooltip if available
        if (correlationValue !== null) {
          result += `<hr style="margin:8px 0;border-color:#444;"/>
                    <div style="color:#fadb14;font-size:11px;">
                      Correlation r = <strong>${correlationValue.toFixed(3)}</strong>
                    </div>`;
        }
        return result;
      }
    },
    legend: {
      data: legendData,
      textStyle: { color: '#aaa', fontSize: 12 },
      bottom: 5
    },
    grid: {
      top: '15%',
      left: '6%',
      right: '6%',
      bottom: '18%',
      containLabel: true
    },
    xAxis: {
      type: 'value',
      max: data.duration_seconds,
      axisLabel: {
        color: '#666',
        formatter: (val) => formatTime(val)
      },
      axisPointer: {
        show: true,
        lineStyle: { color: '#f3d987', type: 'solid', width: 1 }
      },
      splitLine: { lineStyle: { color: '#14151a' } }
    },
    yAxis: [
      {
        type: 'value',
        name: leftAxisName,
        nameTextStyle: { color: '#5eead4', fontSize: 11 },
        position: 'left',
        min: subtitleMetric === 'density' ? undefined : -1.0,
        max: subtitleMetric === 'density' ? undefined : 1.0,
        axisLabel: { 
          color: '#5eead4',
          formatter: (val) => val.toFixed(2)
        },
        splitLine: { lineStyle: { color: '#1a1b22' } }
      },
      {
        type: 'value',
        name: rightAxisName,
        nameTextStyle: { color: '#fadb14', fontSize: 11 },
        position: 'right',
        min: -1.0,
        max: 1.0,
        show: colorMetric !== null,
        axisLabel: { 
          color: '#fadb14',
          formatter: (val) => val.toFixed(2)
        },
        splitLine: { show: false }
      }
    ],
    // Embed movie real barcode graphic as thin strip below graph
    graphic: [{
      type: 'image',
      id: 'barcode-bg',
      style: {
        image: `assets/barcodes/${data.id}.png`,
        width: '100%',
        height: 20
      },
      left: '5%',
      right: '4%',
      bottom: 40
    }],
    series: series
  }, true);

  // Synchronized cursor to display corresponding dialogue text in real time!
  c2Chart.off('updateAxisPointer'); // prevent double event binds
  c2Chart.on('updateAxisPointer', (event) => {
    if (!event.axesInfo || event.axesInfo.length === 0) return;
    const timeSec = event.axesInfo[0].value;
    updateLiveSubtitle(timeSec, data);
  });
}

// Calculate Pearson correlation coefficient
function calculateCorrelation(arrX, arrY) {
  const n = arrX.length;
  if (n !== arrY.length || n === 0) return 0;
  
  const meanX = arrX.reduce((sum, x) => sum + x, 0) / n;
  const meanY = arrY.reduce((sum, y) => sum + y, 0) / n;
  
  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  
  for (let i = 0; i < n; i++) {
    const dx = arrX[i] - meanX;
    const dy = arrY[i] - meanY;
    sumXY += dx * dy;
    sumX2 += dx * dx;
    sumY2 += dy * dy;
  }
  
  const denominator = Math.sqrt(sumX2 * sumY2);
  return denominator === 0 ? 0 : sumXY / denominator;
}

// Update C2 live subtitle and pixel palettes
function updateLiveSubtitle(timeSec, data = null) {
  // This function is kept for compatibility but the subtitle panel has been replaced with poster
  // No action needed as we removed the live subtitle display
}

// Render the Scatter plot mode representing property correlations (dynamic based on selected metrics)
// Now shows ALL movies' segments aggregated data
async function renderC2Scatter(data) {
  // If no data provided or need to load all movies
  let allSegments = [];
  let manifestIds = [];

  if (data && data.segments) {
    // Single movie mode - use provided data's segments
    allSegments = data.segments.map(seg => ({
      ...seg,
      movieId: data.id,
      movieTitle: data.title
    }));
  } else {
    // Multi-movie mode: Load all movies from manifest and collect segments
    try {
      const manifestRes = await fetch('assets/data/manifest.json');
      manifestIds = await manifestRes.json();

      // Load all movies sequentially (to avoid overwhelming the server)
      for (const movieId of manifestIds) {
        const movieData = await loadMovieData(movieId);
        if (movieData && movieData.segments) {
          movieData.segments.forEach(seg => {
            allSegments.push({
              ...seg,
              movieId: movieData.id,
              movieTitle: movieData.title
            });
          });
        }
      }
    } catch (err) {
      console.error("Failed to load movies for C2 scatter:", err);
      return;
    }
  }

  if (allSegments.length === 0) return;

  const n = allSegments.length;
  console.log(`✅ C2 Scatter: Loaded ${n} segments from ${manifestIds.length} movies`);

  // ============================================
  // 🧠 智能分析：计算所有指标组合的相关性
  // ============================================
  const metricsConfig = {
    'brightness': {
      name: 'Brightness',
      label: 'Scene Brightness (0-255)',
      getValue: (seg) => (seg.avg_color[0] * 0.299 + seg.avg_color[1] * 0.587 + seg.avg_color[2] * 0.114)
    },
    'saturation': {
      name: 'Saturation',
      label: 'Scene Saturation (0-100%)',
      getValue: (seg) => {
        const r = seg.avg_color[0] / 255, g = seg.avg_color[1] / 255, b = seg.avg_color[2] / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        return max === 0 ? 0 : (max - min) / max * 100;
      }
    },
    'hue': {
      name: 'Hue',
      label: 'Scene Hue (0-360°)',
      getValue: (seg) => {
        const r = seg.avg_color[0] / 255, g = seg.avg_color[1] / 255, b = seg.avg_color[2] / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        if (max === min) return 0;
        let h = 0;
        const d = max - min;
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
        return h * 360;
      }
    },
    'sentiment': {
      name: 'Sentiment',
      label: 'Dialogue Sentiment (-1 to +1)',
      getValue: (seg) => seg.avg_sentiment
    },
    'density': {
      name: 'Density',
      label: 'Dialogue Density (wpm)',
      getValue: (seg) => seg.dialogue_density
    }
  };

  // 计算所有可能的指标对相关性（X轴 vs Y轴）
  const xMetrics = ['brightness', 'saturation', 'hue'];
  const yMetrics = ['sentiment', 'density'];
  let allCorrelations = [];

  xMetrics.forEach(xMet => {
    yMetrics.forEach(yMet => {
      const xVals = allSegments.map(s => metricsConfig[xMet].getValue(s));
      const yVals = allSegments.map(s => metricsConfig[yMet].getValue(s));
      const corr = calculatePearson(xVals, yVals);
      allCorrelations.push({
        x: xMet,
        y: yMet,
        r: corr,
        absR: Math.abs(corr),
        comboName: `${metricsConfig[xMet].name} vs ${metricsConfig[yMet].name}`
      });
    });
  });

  // 按绝对相关性排序，找到最强的组合
  allCorrelations.sort((a, b) => b.absR - a.absR);
  const bestCombo = allCorrelations[0];

  console.log('所有指标组合相关性:');
  allCorrelations.forEach(c => console.log(`   ${c.comboName}: r = ${c.r.toFixed(3)}`));

  // 使用用户选择的指标或默认使用最佳组合
  const finalColorMetric = c2ActiveMetrics.brightness || c2ActiveMetrics.saturation || c2ActiveMetrics.hue ?
    (c2ActiveMetrics.brightness ? 'brightness' : (c2ActiveMetrics.saturation ? 'saturation' : 'hue')) :
    bestCombo.x; // 默认用最佳X轴

  const finalSubtitleMetric = c2ActiveMetrics.sentiment || c2ActiveMetrics.density ?
    (c2ActiveMetrics.sentiment ? 'sentiment' : 'density') :
    bestCombo.y; // 默认用最佳Y轴

  const getXValue = metricsConfig[finalColorMetric].getValue;
  const getYValue = metricsConfig[finalSubtitleMetric].getValue;

  // Build scatter points: [colorValue, subtitleValue]
  const points = allSegments.map((seg, idx) => [getXValue(seg), getYValue(seg)]);

  // Least squares linear regression line
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  allSegments.forEach(seg => {
    const xVal = getXValue(seg);
    const yVal = getYValue(seg);
    sumX += xVal;
    sumY += yVal;
    sumXY += xVal * yVal;
    sumXX += xVal * xVal;
  });

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Calculate Pearson correlation coefficient r
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0, denX = 0, denY = 0;
  allSegments.forEach(seg => {
    const dx = getXValue(seg) - meanX;
    const dy = getYValue(seg) - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  });
  const r = num / Math.sqrt(denX * denY);

  // Build the trendline series
  const xMin = Math.min(...points.map(p => p[0]));
  const xMax = Math.max(...points.map(p => p[0]));
  const lineData = [
    [xMin, slope * xMin + intercept],
    [xMax, slope * xMax + intercept]
  ];

  // Dynamic axis labels based on selected metrics
  const xAxisLabel = metricsConfig[finalColorMetric].label;
  const yAxisLabel = metricsConfig[finalSubtitleMetric].label;
  const xMetricName = metricsConfig[finalColorMetric].name;
  const yMetricName = metricsConfig[finalSubtitleMetric].name;

  // Determine dynamic correlation summary
  let rText = `Correlation r = ${r.toFixed(3)}. `;
  if (Math.abs(r) < 0.1) {
    rText += `${xMetricName} and ${yMetricName} show very weak or no linear correlation.`;
  } else if (Math.abs(r) < 0.3) {
    rText += `${xMetricName} and ${yMetricName} show weak linear correlation.`;
  } else if (r >= 0.3) {
    rText += `${xMetricName} and ${yMetricName} show significant positive correlation (higher ${xMetricName} aligns with more positive sentiment).`;
  } else {
    rText += `${xMetricName} and ${yMetricName} show significant negative correlation (higher ${xMetricName} aligns with more negative sentiment).`;
  }

  // 智能洞察：检测数据中的有趣模式
  let insights = [];
  
  // 1. 检查最佳组合是否比当前组合更好
  if (bestCombo.comboName !== `${xMetricName} vs ${yMetricName}` && bestCombo.absR > Math.abs(r)) {
    insights.push(`<strong>Suggested Toggle:</strong> Try the <span style="color:#ffa502">${bestCombo.comboName}</span> combination for a stronger correlation (r=${bestCombo.r.toFixed(3)})`);
  }

  // 2. Group analysis by sentiment type
  const emotionGroups = {
    'positive': allSegments.filter(s => s.avg_sentiment > 0.1),
    'negative': allSegments.filter(s => s.avg_sentiment < -0.1),
    'neutral': allSegments.filter(s => Math.abs(s.avg_sentiment) <= 0.1)
  };

  const posCount = emotionGroups.positive.length;
  const negCount = emotionGroups.negative.length;
  const neuCount = emotionGroups.neutral.length;

  if (posCount > n * 0.3 || negCount > n * 0.3) {
    insights.push(`<strong>Sentiment Distribution:</strong> Positive ${posCount} (${(posCount/n*100).toFixed(0)}%) | Negative ${negCount} (${(negCount/n*100).toFixed(0)}%) | Neutral ${neuCount} (${(neuCount/n*100).toFixed(0)}%)`);
  }

  // 3. Extreme value detection
  const extremePositive = allSegments.filter(s => s.avg_sentiment > 0.5);
  const extremeNegative = allSegments.filter(s => s.avg_sentiment < -0.5);

  if (extremePositive.length > 0 || extremeNegative.length > 0) {
    insights.push(`<strong>Extreme Sentiment:</strong> ${extremePositive.length} ultra-high sentiment segments | ${extremeNegative.length} ultra-low sentiment segments`);
  }

  // Update correlation display in the toolbar
  const corrDisplay = document.getElementById('correlation-display');
  const corrValueEl = document.getElementById('correlation-value');
  if (corrDisplay && corrValueEl) {
    corrDisplay.style.display = 'flex';
    corrValueEl.textContent = r.toFixed(3);

    // Color code based on strength
    const absCorr = Math.abs(r);
    if (absCorr > 0.7) {
      corrValueEl.style.color = '#ff4757'; // Strong correlation - red
    } else if (absCorr > 0.3) {
      corrValueEl.style.color = '#ffa502'; // Moderate correlation - orange
    } else {
      corrValueEl.style.color = '#2ed573'; // Weak correlation - green
    }
  }

  const footerEl = document.getElementById('c2-insight-footer');
  if (footerEl) {
    footerEl.innerHTML = `<span style="color:#888;font-size:12px;">${n} segments · ${rText}</span>`;
  }

  c2Chart.setOption({
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(15,15,20,0.95)',
      borderColor: '#444',
      textStyle: { color: '#fff' },
      formatter: function (params) {
        if (params.seriesIndex === 0) {
          const seg = allSegments[params.dataIndex];
          if (!seg) return 'Data point details';
          return `
            <div style="font-weight:bold;color:var(--fc-accent-cool);margin-bottom:6px;">${seg.movieTitle || 'Unknown Movie'}</div>
            <div style="font-size:12px;margin-bottom:4px;color:#aaa;">📽 Segment: ${seg.title || 'Untitled'}</div>
            <div style="font-size:11px;color:#888;margin-bottom:4px;">⏱ Time: ${formatTime(seg.start_time || 0)} - ${formatTime(seg.end_time || 0)}</div>
            <div>${xMetricName}: ${(params.value[0] || 0).toFixed(1)}</div>
            <div>${yMetricName}: ${(params.value[1] || 0).toFixed(2)}</div>
            <div style="margin-top:6px;border-top:1px solid #333;padding-top:4px;">
              Dominant Sentiment: <strong>${seg.dominant_emotion || 'N/A'}</strong> |
              Color: <div style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${seg.avg_color ? 'rgb(' + seg.avg_color.join(',') + ')' : '#888'}"></div>
            </div>
            <div style="margin-top:4px;font-size:11px;color:#888;max-width:280px;line-height:1.3;">${(seg.summary || '').substring(0, 100)}${(seg.summary || '').length > 100 ? '...' : ''}</div>
          `;
        }
        return 'Linear Regression Fit Trendline';
      }
    },
    grid: {
      top: '18%',
      left: '5%',
      right: '5%',
      bottom: '12%',
      containLabel: true
    },
    xAxis: {
      type: 'value',
      name: xAxisLabel,
      nameLocation: 'middle',
      nameGap: 25,
      nameTextStyle: { color: '#777' },
      axisLabel: { color: '#666' },
      splitLine: { lineStyle: { color: '#181920' } }
    },
    yAxis: {
      type: 'value',
      name: yAxisLabel,
      nameTextStyle: { color: '#777' },
      axisLabel: { color: '#666' },
      splitLine: { lineStyle: { color: '#181920' } }
    },
    series: [
      {
        name: 'Segment Data Points',
        type: 'scatter',
        symbolSize: function(value, params) {
          // Size based on segment duration (longer segments = larger points)
          const idx = params.dataIndex;
          const seg = allSegments[idx];
          if (!seg || !seg.end_time || !seg.start_time) return 8;
          const duration = (seg.end_time - seg.start_time) / 60; // in minutes
          return Math.max(6, Math.min(15, 6 + duration));
        },
        data: points,
        itemStyle: {
          // 使用真实色彩
          color: function(params) {
            const idx = params.dataIndex;
            const seg = allSegments[idx];
            if (!seg || !seg.avg_color) return '#888';
            return 'rgb(' + seg.avg_color.join(',') + ')';
          },
          opacity: 0.8,
          borderColor: 'rgba(255,255,255,0.2)',
          borderWidth: 0.8
        }
      },
      {
        name: 'Regression Trendline',
        type: 'line',
        showSymbol: false,
        data: lineData,
        lineStyle: {
          color: '#ff3856',
          width: 1.5,
          opacity: 0.9,
          type: 'dashed'
        }
      }
    ]
  }, true);
}

// ============================================
// C2: 热力图模式 - 卡方检验
// ============================================
async function renderC2Heatmap(data) {
  let allSegments = [];
  let manifestIds = [];

  if (data && data.segments) {
    allSegments = data.segments.map(seg => ({
      ...seg,
      movieId: data.id,
      movieTitle: data.title
    }));
  } else {
    try {
      const manifestRes = await fetch('assets/data/manifest.json');
      manifestIds = await manifestRes.json();

      for (const movieId of manifestIds) {
        const movieData = await loadMovieData(movieId);
        if (movieData && movieData.segments) {
          movieData.segments.forEach(seg => {
            allSegments.push({
              ...seg,
              movieId: movieData.id,
              movieTitle: movieData.title
            });
          });
        }
      }
    } catch (err) {
      console.error("Failed to load movies for C2 heatmap:", err);
      return;
    }
  }

  if (allSegments.length === 0) return;

  const n = allSegments.length;
  console.log(`✅ C2 Heatmap: Loaded ${n} segments from ${manifestIds.length} movies`);

  // Metrics config (consistent with scatter plot)
  const metricsConfig = {
    'brightness': {
      name: 'Brightness',
      label: 'Scene Brightness',
      getValue: (seg) => (seg.avg_color[0] * 0.299 + seg.avg_color[1] * 0.587 + seg.avg_color[2] * 0.114),
      categories: ['Dark', 'Medium', 'Bright'],
      thresholds: [85, 170]
    },
    'saturation': {
      name: 'Saturation',
      label: 'Scene Saturation',
      getValue: (seg) => {
        const r = seg.avg_color[0] / 255, g = seg.avg_color[1] / 255, b = seg.avg_color[2] / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        return max === 0 ? 0 : (max - min) / max * 100;
      },
      categories: ['Low', 'Medium', 'High'],
      thresholds: [33, 66]
    },
    'hue': {
      name: 'Hue',
      label: 'Scene Hue',
      getValue: (seg) => {
        const r = seg.avg_color[0] / 255, g = seg.avg_color[1] / 255, b = seg.avg_color[2] / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        if (max === min) return 0;
        let h = 0;
        const d = max - min;
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
        return h * 360;
      },
      categories: ['Cool', 'Neutral', 'Warm'],
      thresholds: [120, 240]
    },
    'sentiment': {
      name: 'Sentiment',
      label: 'Dialogue Sentiment',
      getValue: (seg) => seg.avg_sentiment,
      categories: ['Negative', 'Neutral', 'Positive'],
      thresholds: [-0.1, 0.1]
    },
    'density': {
      name: 'Density',
      label: 'Dialogue Density',
      getValue: (seg) => seg.dialogue_density,
      categories: ['Low', 'Medium', 'High'],
      thresholds: [50, 100]
    }
  };

  // 确定当前指标
  const xMetric = c2ActiveMetrics.hue ? 'hue' : (c2ActiveMetrics.brightness ? 'brightness' : (c2ActiveMetrics.saturation ? 'saturation' : 'brightness'));
  const yMetric = c2ActiveMetrics.sentiment ? 'sentiment' : (c2ActiveMetrics.density ? 'density' : 'sentiment');

  const xConfig = metricsConfig[xMetric];
  const yConfig = metricsConfig[yMetric];

  // ============================================
  // 将连续变量转换为分类变量
  // ============================================
  function categorize(value, thresholds, categories) {
    if (value < thresholds[0]) return categories[0];
    else if (value < thresholds[1]) return categories[1];
    else return categories[2];
  }

  const xCategories = xConfig.categories;
  const yCategories = yConfig.categories;

  // 构建列联表 (contingency table)
  const contingencyTable = {};
  xCategories.forEach(xCat => {
    contingencyTable[xCat] = {};
    yCategories.forEach(yCat => {
      contingencyTable[xCat][yCat] = 0;
    });
  });

  allSegments.forEach(seg => {
    const xVal = xConfig.getValue(seg);
    const yVal = yConfig.getValue(seg);

    const xCat = categorize(xVal, xConfig.thresholds, xCategories);
    const yCat = categorize(yVal, yConfig.thresholds, yCategories);

    contingencyTable[xCat][yCat]++;
  });

  console.log('列联表:', contingencyTable);

  // ============================================
  // 计算卡方统计量 (Chi-squared test)
  // ============================================
  const rowTotals = {};
  const colTotals = {};

  xCategories.forEach(xCat => {
    rowTotals[xCat] = 0;
    yCategories.forEach(yCat => {
      rowTotals[xCat] += contingencyTable[xCat][yCat];
    });
  });

  yCategories.forEach(yCat => {
    colTotals[yCat] = 0;
    xCategories.forEach(xCat => {
      colTotals[yCat] += contingencyTable[xCat][yCat];
    });
  });

  const grandTotal = n;

  // 计算期望频数和卡方值
  let chiSquare = 0;
  const expectedTable = {};
  const residualTable = {}; // 标准化残差

  xCategories.forEach((xCat, i) => {
    expectedTable[xCat] = {};
    residualTable[xCat] = {};
    yCategories.forEach((yCat, j) => {
      const observed = contingencyTable[xCat][yCat];
      const expected = (rowTotals[xCat] * colTotals[yCat]) / grandTotal;
      expectedTable[xCat][yCat] = expected;

      // 卡方分量
      if (expected > 0) {
        chiSquare += Math.pow(observed - expected, 2) / expected;
      }

      // 标准化残差 (用于热力图着色)
      residualTable[xCat][yCat] = expected > 0 ?
        (observed - expected) / Math.sqrt(expected) :
        0;
    });
  });

  // 自由度
  const df = (xCategories.length - 1) * (yCategories.length - 1);

  // 显著性判断
  const criticalValue = df === 4 ? 9.488 : (df === 2 ? 5.991 : 3.841);
  const isSignificant = chiSquare > criticalValue;

  console.log(`卡方统计量: χ²(${df}) = ${chiSquare.toFixed(2)}`);

  // 更新统计显示
  const corrValueEl = document.getElementById('correlation-value');
  if (corrValueEl) {
    const pText = isSignificant ? ', p < .05' : ', p ≥ .05';
    corrValueEl.textContent = `χ² = ${chiSquare.toFixed(2)} (df=${df})${pText}`;

    if (isSignificant) {
      corrValueEl.style.color = '#ff4757'; // 显著 - 红色
    } else {
      corrValueEl.style.color = '#2ed573'; // 不显著 - 绿色
    }
  }

  // 准备热力图数据（使用归一化频数）
  const heatmapData = [];
  let maxCount = 0;
  xCategories.forEach((xCat, i) => {
    yCategories.forEach((yCat, j) => {
      const count = contingencyTable[xCat][yCat];
      if (count > maxCount) maxCount = count;
      heatmapData.push([i, j, count]);
    });
  });

  // 渲染热力图
  c2Chart.setOption({
    tooltip: {
      position: 'top',
      formatter: function(params) {
        const i = params.data[0];
        const j = params.data[1];
        const count = params.data[2];
        const xCat = xCategories[i];
        const yCat = yCategories[j];
        const percentage = ((count / grandTotal) * 100).toFixed(1);

        return `
          <div style="font-weight:bold;color:#ffa502;margin-bottom:6px;">${xConfig.name}: ${xCat} | ${yConfig.name}: ${yCat}</div>
          <div>Observed Count: <strong>${count}</strong> (${percentage}%)</div>
        `;
      }
    },
    grid: {
      top: '15%',
      left: '15%',
      right: '20%',
      bottom: '15%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: xCategories,
      name: xConfig.label,
      nameLocation: 'middle',
      nameGap: 30,
      axisLabel: { color: '#aaa', fontSize: 12 }
    },
    yAxis: {
      type: 'category',
      data: yCategories,
      name: yConfig.label,
      nameLocation: 'middle',
      nameGap: 40,
      axisLabel: { color: '#aaa', fontSize: 12 }
    },
    visualMap: {
      min: 0,
      max: maxCount,
      calculable: true,
      orient: 'vertical',
      right: '5%',
      top: 'center',
      inRange: {
        color: ['#fff5f0', '#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a',
                 '#ef3b2c', '#cb181d', '#a50f15', '#67000d']
      },
      text: ['High', 'Low'],
      textStyle: { color: '#888' }
    },
    series: [{
      name: 'Observed Frequency',
      type: 'heatmap',
      data: heatmapData,
      label: {
        show: true,
        formatter: function(params) {
          return params.data[2]; // 显示实际频数
        },
        fontSize: 14,
        fontWeight: 'bold',
        color: '#000' // 黑色文字
      },
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowColor: 'rgba(255, 165, 2, 0.5)'
        }
      },
      itemStyle: {
        borderColor: '#fff',
        borderWidth: 2
      }
    }]
  }, true);

  // Heatmap mode: bottom shows a simple description
  const footerEl = document.getElementById('c2-insight-footer');
  if (footerEl) {
    let briefText = isSignificant ?
      `Statistically Significant (${xConfig.name} & ${yConfig.name} are associated)` :
      'Not Significant (may be independent)';
    footerEl.innerHTML = `<span style="color:#888;font-size:12px;">${briefText}</span>`;
  }
}

// Calculate Pearson correlation coefficient
function calculatePearson(xVals, yVals) {
  const n = xVals.length;
  if (n === 0 || n !== yVals.length) return 0;

  const meanX = xVals.reduce((a, b) => a + b, 0) / n;
  const meanY = yVals.reduce((a, b) => a + b, 0) / n;

  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xVals[i] - meanX;
    const dy = yVals[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  return denX === 0 || denY === 0 ? 0 : num / Math.sqrt(denX * denY);
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
